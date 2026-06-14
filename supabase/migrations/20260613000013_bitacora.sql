-- ============================================================================
--  CONTROLA · Migración 0013 · BITÁCORA (registro de actividad)
--  Toda acción que afecta al negocio queda registrada: quién (nombre, no el PIN),
--  qué (evento clasificado), cuándo (fecha y hora) y el impacto (descripción).
--  Las acciones de SOLO LECTURA (ver reportes/caja) NO se registran.
--  Retención: se conservan los últimos 7 días; una purga nocturna (pg_cron)
--  borra lo más viejo. La pantalla /bitacora filtra por fecha y por evento.
-- ============================================================================

-- ----------------------------------------------------------------------------
--  Catálogo de tipos de evento (GLOBAL; igual para todos los restaurantes).
--  Permite agrupar y filtrar la bitácora por categoría o por evento puntual.
-- ----------------------------------------------------------------------------
create table activity_events (
  code        text primary key,
  label       text not null,
  category    text not null,           -- acceso | ventas | caja | costos | inventario | menu | cierre | config
  sort_order  int  not null default 0
);

insert into activity_events (code, label, category, sort_order) values
  -- Acceso (entrar/salir de la app)
  ('login',            'Inicio de sesión',        'acceso',     10),
  ('logout',           'Cierre de sesión',        'acceso',     11),
  ('cambio_turno',     'Cambio de turno',         'acceso',     12),
  -- Ventas
  ('venta',            'Venta',                   'ventas',     20),
  -- Caja
  ('caja_inicial',     'Caja inicial',            'caja',       30),
  ('ingreso_caja',     'Ingreso a caja',          'caja',       31),
  ('egreso_caja',      'Retiro de caja',          'caja',       32),
  -- Costos / compras
  ('gasto',            'Gasto',                   'costos',     40),
  ('compra',           'Compra de inventario',    'costos',     41),
  -- Inventario / cocina
  ('produccion',       'Producción',              'inventario', 50),
  ('procesar',         'Procesar insumo',         'inventario', 51),
  ('consumo',          'Consumo del día',         'inventario', 52),
  ('retiro_insumo',    'Retiro de inventario',    'inventario', 53),
  ('merma',            'Merma',                   'inventario', 54),
  ('ajuste_inventario','Ajuste de inventario',    'inventario', 55),
  ('conteo',           'Conteo de cierre',        'inventario', 56),
  ('producto_nuevo',   'Producto nuevo',          'inventario', 57),
  -- Menú / recetas
  ('menu',             'Menú del día',            'menu',       60),
  ('agotado',          'Plato agotado',           'menu',       61),
  ('receta',           'Receta',                  'menu',       62),
  -- Cierres
  ('cerrar_turno',     'Cierre de turno',         'cierre',     70),
  ('cerrar_dia',       'Cierre del día',          'cierre',     71),
  -- Configuración (administración)
  ('usuario',          'Usuario / PIN',           'config',     80),
  ('turno_config',     'Turno (configuración)',   'config',     81),
  ('plato_config',     'Plato (catálogo)',        'config',     82),
  ('costo_fijo',       'Costo fijo',              'config',     83);

-- ----------------------------------------------------------------------------
--  Bitácora: una fila por acción. Guarda el NOMBRE de quien la hizo (snapshot,
--  por si el usuario se borra) y una descripción legible del impacto.
-- ----------------------------------------------------------------------------
create table activity_log (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references restaurants(id) on delete cascade,
  user_id          uuid references users(id) on delete set null,
  actor_name       text,                                -- nombre de quien actuó (no el PIN)
  shift_session_id uuid references shift_sessions(id) on delete set null,
  event_code       text not null references activity_events(code),
  source           text not null default 'manual'
                   check (source in ('ia', 'manual', 'sistema')),
  description      text not null,                       -- impacto legible
  metadata         jsonb,
  created_at       timestamptz not null default now()
);
create index idx_activity_restaurant on activity_log(restaurant_id, created_at desc);
create index idx_activity_event on activity_log(restaurant_id, event_code, created_at desc);
create index idx_activity_created on activity_log(created_at);   -- para la purga

-- ----------------------------------------------------------------------------
--  RLS (defensa en profundidad; el servidor usa service role que la ignora).
-- ----------------------------------------------------------------------------
alter table activity_events enable row level security;
alter table activity_log    enable row level security;

-- el catálogo es global y no sensible: lectura para cualquiera autenticado
create policy events_select on activity_events for select using (true);

create policy activity_select on activity_log for select
  using (restaurant_id = app.restaurant_id());
create policy activity_insert on activity_log for insert
  with check (restaurant_id = app.restaurant_id());

-- ----------------------------------------------------------------------------
--  Lectura de la bitácora con filtros (fecha en zona Ecuador + categoría/evento).
--  Devuelve un arreglo JSON ordenado de lo más reciente a lo más antiguo.
-- ----------------------------------------------------------------------------
create or replace function bitacora_listar(
  p_restaurant uuid,
  p_from       date,
  p_to         date,
  p_category   text default null,
  p_event      text default null
) returns jsonb
  language sql
  stable
  security definer
  set search_path = public, app
as $$
  select coalesce(jsonb_agg(t order by t.created_at desc), '[]'::jsonb)
  from (
    select
      l.id,
      l.created_at,
      l.actor_name,
      l.source,
      l.event_code,
      e.label    as event_label,
      e.category as category,
      l.description,
      l.metadata
    from activity_log l
    join activity_events e on e.code = l.event_code
    where l.restaurant_id = p_restaurant
      and (l.created_at at time zone 'America/Guayaquil')::date >= p_from
      and (l.created_at at time zone 'America/Guayaquil')::date <= p_to
      and (p_category is null or e.category = p_category)
      and (p_event    is null or l.event_code = p_event)
    order by l.created_at desc
    limit 1000
  ) t;
$$;

-- ----------------------------------------------------------------------------
--  Purga de retención: borra lo anterior a N días (por defecto 7). La ejecuta
--  el cron nocturno; también se puede llamar manualmente. Devuelve cuántas borró.
-- ----------------------------------------------------------------------------
create or replace function purgar_bitacora(p_days int default 7)
returns int
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_deleted int;
begin
  delete from activity_log
   where created_at < now() - make_interval(days => greatest(p_days, 1));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- grants: el servidor (service_role) lee/purga; el público no.
revoke all on function bitacora_listar(uuid, date, date, text, text) from public;
grant execute on function bitacora_listar(uuid, date, date, text, text) to service_role;
revoke all on function purgar_bitacora(int) from public;
grant execute on function purgar_bitacora(int) to service_role;

-- ----------------------------------------------------------------------------
--  Cron nocturno (pg_cron): purga diaria a las 05:00 UTC ≈ 00:00 en Ecuador
--  (UTC-5). Va dentro de un bloque protegido para que el `supabase db reset`
--  local no falle si la extensión pg_cron no está disponible en el entorno.
-- ----------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
  -- re-agendar de forma idempotente
  begin
    perform cron.unschedule('controla_purgar_bitacora');
  exception when others then
    null;  -- aún no existía
  end;
  perform cron.schedule(
    'controla_purgar_bitacora',
    '0 5 * * *',
    'select purgar_bitacora(7);'
  );
exception when others then
  raise notice 'pg_cron no disponible; agenda purgar_bitacora(7) por otro medio (GitHub Action / Vercel cron). Detalle: %', sqlerrm;
end $$;

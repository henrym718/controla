-- ============================================================================
--  CONTROLA · Migración · CUENTAS DE MESA ("Guardar cuenta" / por cobrar el día)
--
--  Pedido (jun-2026): poder GUARDAR una cuenta del momento (una "mesa") con una
--  etiqueta libre ("Mesa 4", "Rosa"…), agregarle productos, y COBRARLA después
--  el mismo día. Es ANÓNIMA: no va a nombre de un cliente registrado ni acumula
--  deuda entre días (eso es el crédito/fiado, otra cosa).
--
--  MODELO "BORRADOR" acordado:
--   - Guardar/editar la cuenta NO descuenta inventario ni toca la caja: es solo
--     un borrador en la base (sobrevive refresco, lo ven las dos cajeras).
--   - Al COBRAR recién se vuelve venta real: descuenta inventario y entra a caja
--     (efectivo por defecto). La cuenta queda 'cobrada'.
--   - Consecuencia: si quedan cuentas abiertas al cerrar el turno, esa comida ya
--     salió pero el sistema no la ve → el cierre debe AVISAR de las cuentas
--     abiertas (se maneja en la capa de la app).
--
--  PRODUCCIÓN: aditivo, no toca ninguna migración previa. (Corre después de
--   …0003, así que la columna sales.cliente_id ya existe; aquí va null.)
-- ============================================================================

-- ----------------------------------------------------------------------------
--  Tabla: una cuenta de mesa = etiqueta + sus ítems (borrador) + estado.
--  Los ítems se guardan en JSON: [{kind:'plato'|'producto', ref_id, name,
--  unit_price, qty}, ...]. Se cobra como 'servir' (comen ahí); el "para llevar"
--  se hace por la venta normal "Cobrar ahora".
-- ----------------------------------------------------------------------------
create table if not exists cuentas_mesa (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references restaurants(id) on delete cascade,
  shift_session_id uuid references shift_sessions(id),   -- turno donde se abrió
  business_date    date not null default current_date,
  label            text not null,                        -- "Mesa 4", "Rosa", libre
  items            jsonb not null default '[]'::jsonb,
  total            numeric(12,2) not null default 0,     -- cache para la tarjeta
  status           text not null default 'abierta'
                   check (status in ('abierta', 'cobrada', 'anulada')),
  created_by       uuid references users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  cobrada_at       timestamptz,
  cobrada_by       uuid references users(id),
  op_id            uuid                                   -- op del cobro (reversible)
);
create index if not exists idx_cuentas_mesa_abiertas
  on cuentas_mesa(restaurant_id, status);

alter table cuentas_mesa enable row level security;
create policy cuentas_mesa_all on cuentas_mesa for all
  using (restaurant_id = app.restaurant_id())
  with check (restaurant_id = app.restaurant_id());

-- ============================================================================
--  RPC · cobrar_cuenta_mesa — convierte la cuenta (borrador) en ventas reales.
--   Recorre sus ítems: por cada uno inserta la venta y descuenta inventario
--   (igual que registrar_venta, servir), TODO bajo UN mismo op_id (así se anula
--   la mesa completa de una). Marca la cuenta 'cobrada'. Atómico (una función).
-- ============================================================================
create or replace function cobrar_cuenta_mesa(
  p_restaurant     uuid,
  p_session        uuid,
  p_user           uuid,
  p_date           date,
  p_cuenta_id      uuid,
  p_payment_method text default 'efectivo'   -- 'efectivo' | 'transferencia' | 'otro'
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_cuenta  cuentas_mesa;
  v_op      uuid := gen_random_uuid();
  v_total   numeric(12,2) := 0;
  v_n       int := 0;
  v_sale_id uuid;
  v_line    numeric(12,2);
  it        record;
  r         record;
begin
  select * into v_cuenta from cuentas_mesa
   where id = p_cuenta_id and restaurant_id = p_restaurant
   for update;
  if v_cuenta.id is null then raise exception 'Cuenta no encontrada'; end if;
  if v_cuenta.status <> 'abierta' then
    raise exception 'La cuenta ya fue % ', v_cuenta.status;
  end if;

  for it in
    select * from jsonb_to_recordset(v_cuenta.items)
      as x(kind text, ref_id uuid, name text, unit_price numeric, qty integer)
  loop
    if it.ref_id is null or coalesce(it.qty, 0) <= 0 then continue; end if;
    v_line := round(coalesce(it.unit_price, 0) * it.qty, 2);

    insert into sales (restaurant_id, shift_session_id, user_id, business_date,
                       item_kind, dish_id, ingredient_id, dish_name, qty,
                       unit_price, total, service_type, payment_method, op_id)
    values (p_restaurant, p_session, p_user, p_date,
            it.kind,
            case when it.kind = 'plato'    then it.ref_id end,
            case when it.kind = 'producto' then it.ref_id end,
            it.name, it.qty, coalesce(it.unit_price, 0), v_line,
            'servir', p_payment_method, v_op)
    returning id into v_sale_id;

    if it.kind = 'plato' then
      for r in
        select dc.qty, i.id as ing_id, i.last_unit_cost
        from dish_components dc
        join ingredients i on i.id = dc.ingredient_id
        where dc.dish_id = it.ref_id and i.kind = 'contable'
      loop
        insert into inventory_movements (restaurant_id, ingredient_id, shift_session_id,
                                         business_date, type, qty, unit_cost, ref_table, ref_id, op_id)
        values (p_restaurant, r.ing_id, p_session, p_date, 'venta',
                -(r.qty * it.qty), coalesce(r.last_unit_cost, 0), 'sales', v_sale_id, v_op);
      end loop;
    elsif it.kind = 'producto' then
      insert into inventory_movements (restaurant_id, ingredient_id, shift_session_id,
                                       business_date, type, qty, unit_cost, ref_table, ref_id, op_id)
      select p_restaurant, i.id, p_session, p_date, 'venta',
             -it.qty, coalesce(i.last_unit_cost, 0), 'sales', v_sale_id, v_op
      from ingredients i where i.id = it.ref_id;
    end if;

    v_total := v_total + v_line;
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then raise exception 'La cuenta no tiene productos que cobrar'; end if;

  update cuentas_mesa
     set status = 'cobrada', cobrada_at = now(), cobrada_by = p_user, op_id = v_op,
         updated_at = now()
   where id = p_cuenta_id;

  insert into audit_log (restaurant_id, user_id, shift_session_id, action, entity, entity_id, payload)
  values (p_restaurant, p_user, p_session, 'cobrar_mesa', 'cuentas_mesa', p_cuenta_id,
          jsonb_build_object('label', v_cuenta.label, 'total', v_total, 'items', v_n,
                             'payment_method', p_payment_method, 'op_id', v_op));

  return jsonb_build_object('cuenta_id', p_cuenta_id, 'total', v_total, 'count', v_n, 'op_id', v_op);
end;
$$;

-- ----------------------------------------------------------------------------
--  Permisos: solo el servidor (service_role).
-- ----------------------------------------------------------------------------
revoke all on function cobrar_cuenta_mesa(uuid, uuid, uuid, date, uuid, text) from public;
grant execute on function cobrar_cuenta_mesa(uuid, uuid, uuid, date, uuid, text) to service_role;

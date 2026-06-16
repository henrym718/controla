-- ============================================================================
--  CONTROLA · Migración · CLIENTES + VENTAS A CRÉDITO (FIADO)
--
--  Pedido (jun-2026): clientes/empleados que comen y pagan después (durante la
--  semana), y las chicas que toman colas a crédito. Se registra a nombre de la
--  persona y la deuda se acumula; el cobro entra después.
--
--  CONTABILIDAD ACORDADA:
--   - La VENTA a crédito cuenta ganancia y costo (descuenta inventario igual que
--     una venta normal) PERO no entra a la caja → payment_method 'credito'
--     (v_caja_turno solo suma lo 'efectivo', así que NO infla el cuadre y la
--     cajera no carga con plata que no entró).
--   - El COBRO posterior es un INGRESO de caja etiquetado 'cobro_credito': suma
--     al efectivo real (el cuadre lo ve, porque cuenta TODOS los ingresos) pero
--     NO vuelve a contar venta ni costo → no hay doble conteo.
--   - Saldo por persona = sus ventas a crédito − sus cobros (vista v_saldos_credito).
--
--  PRODUCCIÓN: NO se edita ninguna migración previa. Todo es ADITIVO: tabla
--   nueva, columnas nuevas (alter ... add column), CHECK ampliado y funciones
--   nuevas. La bitácora/reversa reusa los códigos existentes 'venta' e
--   'ingreso_caja' desde la capa de la app, así que NO hace falta tocar
--   activity_events ni operaciones_reversibles (las ventas a crédito y los
--   cobros quedan reversibles por su op_id como cualquier venta/ingreso).
-- ============================================================================

-- ----------------------------------------------------------------------------
--  (1) CLIENTES — personas que pueden comprar a crédito (cliente o empleado).
--      El admin las registra (solo el nombre + el tipo). Las chicas las usan
--      para registrar ventas a crédito y ver/cobrar saldos.
-- ----------------------------------------------------------------------------
create table if not exists clientes (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name          text not null,
  kind          text not null default 'cliente' check (kind in ('cliente', 'empleado')),
  active        boolean not null default true,
  created_by    uuid references users(id),
  created_at    timestamptz not null default now()
);
-- Un nombre por restaurante (sin distinguir mayúsculas ni espacios sobrantes).
create unique index if not exists uq_clientes_nombre
  on clientes(restaurant_id, lower(btrim(name)));
create index if not exists idx_clientes_lookup on clientes(restaurant_id, active);

alter table clientes enable row level security;
create policy clientes_all on clientes for all
  using (restaurant_id = app.restaurant_id())
  with check (restaurant_id = app.restaurant_id());

-- ----------------------------------------------------------------------------
--  (2) VENTA A CRÉDITO — ligar la venta al cliente y permitir el método 'credito'.
-- ----------------------------------------------------------------------------
alter table sales add column if not exists cliente_id uuid references clientes(id);
create index if not exists idx_sales_cliente on sales(cliente_id) where cliente_id is not null;

-- Ampliar el CHECK de payment_method para incluir 'credito' (sin tocar filas).
-- Quita el CHECK viejo sea cual sea su nombre autogenerado y agrega el ampliado.
do $$
declare
  v_con text;
begin
  select conname into v_con
  from pg_constraint
  where conrelid = 'public.sales'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%payment_method%';
  if v_con is not null then
    execute format('alter table public.sales drop constraint %I', v_con);
  end if;
end $$;
alter table sales
  add constraint sales_payment_method_check
  check (payment_method in ('efectivo', 'transferencia', 'otro', 'credito'));

-- ----------------------------------------------------------------------------
--  (3) COBRO DE CRÉDITO — etiqueta + cliente en el movimiento de caja, para
--      distinguirlo de un aporte normal en los reportes/cierre.
-- ----------------------------------------------------------------------------
alter table cash_movements add column if not exists cliente_id uuid references clientes(id);
alter table cash_movements add column if not exists categoria  text;  -- 'cobro_credito' | null
create index if not exists idx_cash_cliente on cash_movements(cliente_id) where cliente_id is not null;

-- ============================================================================
--  (4) RPC · registrar_venta_credito — UNA línea (plato o producto) a crédito.
--   Misma lógica de inventario que registrar_venta (descuenta receta/producto y
--   envase si es 'llevar'), pero payment_method = 'credito' y cliente_id. Estampa
--   op_id reversible. El servidor la llama por cada línea del carrito.
-- ============================================================================
create or replace function registrar_venta_credito(
  p_restaurant     uuid,
  p_session        uuid,
  p_user           uuid,
  p_date           date,
  p_cliente_id     uuid,
  p_item_kind      text,            -- 'plato' | 'producto'
  p_dish_id        uuid,
  p_ingredient_id  uuid,
  p_name           text,
  p_qty            integer,
  p_unit_price     numeric,
  p_service_type   text default 'servir',
  p_packaging_id   uuid default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_total    numeric(12,2) := round(p_unit_price * p_qty, 2);
  v_sale_id  uuid;
  v_op       uuid := gen_random_uuid();
  v_cli_name text;
  r          record;
begin
  select name into v_cli_name from clientes
   where id = p_cliente_id and restaurant_id = p_restaurant and active;
  if v_cli_name is null then
    raise exception 'Cliente de crédito no encontrado o inactivo';
  end if;

  insert into sales (restaurant_id, shift_session_id, user_id, business_date,
                     item_kind, dish_id, ingredient_id, dish_name, qty,
                     unit_price, total, service_type, payment_method, cliente_id, op_id)
  values (p_restaurant, p_session, p_user, p_date,
          p_item_kind, p_dish_id, p_ingredient_id, p_name, p_qty,
          p_unit_price, v_total, p_service_type, 'credito', p_cliente_id, v_op)
  returning id into v_sale_id;

  if p_item_kind = 'plato' and p_dish_id is not null then
    -- contables de la receta (el granel se prorratea al cierre del día)
    for r in
      select dc.qty, i.id as ing_id, i.last_unit_cost
      from dish_components dc
      join ingredients i on i.id = dc.ingredient_id
      where dc.dish_id = p_dish_id and i.kind = 'contable'
    loop
      insert into inventory_movements (restaurant_id, ingredient_id, shift_session_id,
                                       business_date, type, qty, unit_cost, ref_table, ref_id, op_id)
      values (p_restaurant, r.ing_id, p_session, p_date, 'venta',
              -(r.qty * p_qty), coalesce(r.last_unit_cost, 0), 'sales', v_sale_id, v_op);
    end loop;

    -- envase para llevar
    if p_service_type = 'llevar' then
      if p_packaging_id is not null then
        insert into inventory_movements (restaurant_id, ingredient_id, shift_session_id,
                                         business_date, type, qty, unit_cost, ref_table, ref_id, op_id)
        select p_restaurant, i.id, p_session, p_date, 'venta',
               -p_qty, coalesce(i.last_unit_cost, 0), 'sales', v_sale_id, v_op
        from ingredients i where i.id = p_packaging_id;
      else
        for r in
          select tp.ingredient_id, tp.qty_per_order, i.last_unit_cost
          from takeout_packaging tp
          join ingredients i on i.id = tp.ingredient_id
          where tp.restaurant_id = p_restaurant
        loop
          insert into inventory_movements (restaurant_id, ingredient_id, shift_session_id,
                                           business_date, type, qty, unit_cost, ref_table, ref_id, op_id)
          values (p_restaurant, r.ingredient_id, p_session, p_date, 'venta',
                  -(r.qty_per_order * p_qty), coalesce(r.last_unit_cost, 0), 'sales', v_sale_id, v_op);
        end loop;
      end if;
    end if;

  elsif p_item_kind = 'producto' and p_ingredient_id is not null then
    insert into inventory_movements (restaurant_id, ingredient_id, shift_session_id,
                                     business_date, type, qty, unit_cost, ref_table, ref_id, op_id)
    select p_restaurant, i.id, p_session, p_date, 'venta',
           -p_qty, coalesce(i.last_unit_cost, 0), 'sales', v_sale_id, v_op
    from ingredients i where i.id = p_ingredient_id;
  end if;

  insert into audit_log (restaurant_id, user_id, shift_session_id, action, entity, entity_id, payload)
  values (p_restaurant, p_user, p_session, 'venta_credito', 'sales', v_sale_id,
          jsonb_build_object('name', p_name, 'qty', p_qty, 'total', v_total,
                             'cliente_id', p_cliente_id, 'cliente', v_cli_name, 'op_id', v_op));

  return jsonb_build_object('sale_id', v_sale_id, 'total', v_total, 'op_id', v_op);
end;
$$;

-- ============================================================================
--  (5) RPC · registrar_cobro_credito — cobra (parte de) la deuda de un cliente.
--   Entra como INGRESO de caja etiquetado 'cobro_credito' (suma al efectivo real
--   del turno) ligado al cliente. NO crea venta ni toca inventario → no recalcula
--   costo/ganancia. Reversible por op_id (la app lo registra como 'ingreso_caja').
-- ============================================================================
create or replace function registrar_cobro_credito(
  p_restaurant uuid,
  p_session    uuid,
  p_user       uuid,
  p_cliente_id uuid,
  p_amount     numeric
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_op      uuid := gen_random_uuid();
  v_name    text;
  v_cash_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'El monto del cobro debe ser mayor a 0';
  end if;
  select name into v_name from clientes
   where id = p_cliente_id and restaurant_id = p_restaurant;
  if v_name is null then raise exception 'Cliente no encontrado'; end if;

  insert into cash_movements (restaurant_id, shift_session_id, user_id, type, amount,
                              reason, categoria, cliente_id, op_id)
  values (p_restaurant, p_session, p_user, 'ingreso', p_amount,
          'Cobro crédito: ' || v_name, 'cobro_credito', p_cliente_id, v_op)
  returning id into v_cash_id;

  insert into audit_log (restaurant_id, user_id, shift_session_id, action, entity, entity_id, payload)
  values (p_restaurant, p_user, p_session, 'cobro_credito', 'cash_movements', v_cash_id,
          jsonb_build_object('cliente_id', p_cliente_id, 'cliente', v_name,
                             'amount', p_amount, 'op_id', v_op));

  return jsonb_build_object('cash_id', v_cash_id, 'op_id', v_op, 'amount', p_amount);
end;
$$;

-- ============================================================================
--  (6) VISTA · v_saldos_credito — deuda VIVA por cliente (cargos − cobros).
--   El módulo "Cuentas por cobrar" muestra solo los que tienen saldo > 0.
--   Ignora ventas/cobros anulados (voided_at).
-- ============================================================================
create or replace view v_saldos_credito
  with (security_invoker = on) as
select
  c.restaurant_id,
  c.id   as cliente_id,
  c.name,
  c.kind,
  coalesce((
    select sum(s.total) from sales s
    where s.cliente_id = c.id
      and s.payment_method = 'credito'
      and s.voided_at is null
  ), 0)
  - coalesce((
    select sum(m.amount) from cash_movements m
    where m.cliente_id = c.id
      and m.categoria = 'cobro_credito'
      and m.voided_at is null
  ), 0) as saldo
from clientes c;

-- ----------------------------------------------------------------------------
--  (7) Permisos: solo el servidor (service_role); revocado a anon/authenticated.
-- ----------------------------------------------------------------------------
revoke all on function registrar_venta_credito(uuid, uuid, uuid, date, uuid, text, uuid, uuid, text, integer, numeric, text, uuid) from public;
grant execute on function registrar_venta_credito(uuid, uuid, uuid, date, uuid, text, uuid, uuid, text, integer, numeric, text, uuid) to service_role;

revoke all on function registrar_cobro_credito(uuid, uuid, uuid, uuid, numeric) from public;
grant execute on function registrar_cobro_credito(uuid, uuid, uuid, uuid, numeric) to service_role;

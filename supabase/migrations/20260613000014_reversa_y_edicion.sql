-- ============================================================================
--  CONTROLA · Migración 0014 · REVERSA (anulación) + EDICIÓN DE INVENTARIO
--
--  1) ANULAR transacciones (venta, compra, gasto, movimiento de caja) SIN borrar:
--     - cada operación estampa un op_id común en todas las filas que genera.
--     - anular_operacion(op_id) marca voided_at en todas esas filas (rastro).
--     - todas las agregaciones (caja, stock, ventas, gastos, cuadres) ignoran lo
--       anulado → la plata y el stock se corrigen solos, y queda el reverso visible.
--
--  2) EDITAR / ELIMINAR un producto del inventario (con PIN de admin en la app):
--     - editar_producto: nombre, costo, precio de venta (si es vendible) y ajuste
--       de stock. El ajuste distingue 'correccion' (error de dato, NO cuenta como
--       desfase/robo) de 'ajuste' (conteo físico real, SÍ cuenta como desfase).
--     - eliminar_producto: borra; si tiene historial, lo desactiva.
--
--  3) Bitácora: op_id en activity_log + eventos anulacion/producto_editado/baja,
--     y operaciones_reversibles() para listar qué se puede anular.
-- ============================================================================

-- ----------------------------------------------------------------------------
--  Columnas: op_id (agrupa una operación) + marca de anulación (rastro)
-- ----------------------------------------------------------------------------
alter table sales
  add column if not exists op_id       uuid,
  add column if not exists voided_at   timestamptz,
  add column if not exists voided_by   uuid references users(id),
  add column if not exists void_reason text;

alter table expenses
  add column if not exists op_id       uuid,
  add column if not exists voided_at   timestamptz,
  add column if not exists voided_by   uuid references users(id),
  add column if not exists void_reason text;

alter table cash_movements
  add column if not exists op_id       uuid,
  add column if not exists voided_at   timestamptz,
  add column if not exists voided_by   uuid references users(id),
  add column if not exists void_reason text;

alter table inventory_movements
  add column if not exists op_id       uuid,
  add column if not exists voided_at   timestamptz,
  add column if not exists voided_by   uuid references users(id),
  add column if not exists void_reason text;

create index if not exists idx_sales_op      on sales(op_id) where op_id is not null;
create index if not exists idx_expenses_op   on expenses(op_id) where op_id is not null;
create index if not exists idx_cash_op       on cash_movements(op_id) where op_id is not null;
create index if not exists idx_invmov_op     on inventory_movements(op_id) where op_id is not null;

-- ----------------------------------------------------------------------------
--  Nuevo tipo de movimiento: 'correccion' (corrige stock por error de dato; a
--  diferencia de 'ajuste', NO se cuenta como desfase/robo en la analítica).
-- ----------------------------------------------------------------------------
alter table inventory_movements drop constraint if exists inventory_movements_type_check;
alter table inventory_movements add constraint inventory_movements_type_check
  check (type in ('compra','produccion','venta','retiro','merma','ajuste','correccion'));

-- ----------------------------------------------------------------------------
--  Bitácora: op_id + eventos nuevos + categoría 'reversa'
-- ----------------------------------------------------------------------------
alter table activity_log add column if not exists op_id uuid;
create index if not exists idx_activity_op on activity_log(op_id) where op_id is not null;

insert into activity_events (code, label, category, sort_order) values
  ('producto_editado', 'Producto editado',    'inventario', 58),
  ('producto_baja',    'Producto eliminado',  'inventario', 59),
  ('anulacion',        'Anulación / reverso', 'reversa',    90)
on conflict (code) do nothing;

-- ============================================================================
--  RPC · registrar_venta  (REEMPLAZA 0007: ahora estampa op_id; misma firma)
-- ============================================================================
create or replace function registrar_venta(
  p_restaurant     uuid,
  p_session        uuid,
  p_user           uuid,
  p_date           date,
  p_item_kind      text,
  p_dish_id        uuid,
  p_ingredient_id  uuid,
  p_name           text,
  p_qty            integer,
  p_unit_price     numeric,
  p_service_type   text,
  p_payment_method text,
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
  r          record;
begin
  insert into sales (restaurant_id, shift_session_id, user_id, business_date,
                     item_kind, dish_id, ingredient_id, dish_name, qty,
                     unit_price, total, service_type, payment_method, op_id)
  values (p_restaurant, p_session, p_user, p_date,
          p_item_kind, p_dish_id, p_ingredient_id, p_name, p_qty,
          p_unit_price, v_total, p_service_type, p_payment_method, v_op)
  returning id into v_sale_id;

  if p_item_kind = 'plato' and p_dish_id is not null then
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
  values (p_restaurant, p_user, p_session, 'venta', 'sales', v_sale_id,
          jsonb_build_object('name', p_name, 'qty', p_qty, 'total', v_total,
                             'item_kind', p_item_kind, 'service_type', p_service_type, 'op_id', v_op));

  return jsonb_build_object('sale_id', v_sale_id, 'total', v_total, 'op_id', v_op);
end;
$$;

-- ============================================================================
--  RPC · registrar_gasto  (REEMPLAZA 0007: estampa op_id en gasto + aporte jefa)
-- ============================================================================
create or replace function registrar_gasto(
  p_restaurant uuid,
  p_session    uuid,
  p_user       uuid,
  p_date       date,
  p_amount     numeric,
  p_category   text,
  p_note       text,
  p_fuente     text
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_expense_id uuid;
  v_op         uuid := gen_random_uuid();
begin
  if p_fuente = 'jefa' then
    insert into cash_movements (restaurant_id, shift_session_id, user_id, type, amount, reason, op_id)
    values (p_restaurant, p_session, p_user, 'ingreso', p_amount,
            'Aporte jefa: ' || coalesce(p_note, 'gasto'), v_op);
  end if;

  insert into expenses (restaurant_id, shift_session_id, user_id, business_date,
                        amount, category, note, paid_from_cash, source, op_id)
  values (p_restaurant, p_session, p_user, p_date,
          p_amount, coalesce(p_category, 'otro'), p_note, true, 'manual', v_op)
  returning id into v_expense_id;

  insert into audit_log (restaurant_id, user_id, shift_session_id, action, entity, entity_id, payload, reason)
  values (p_restaurant, p_user, p_session, 'gasto', 'expenses', v_expense_id,
          jsonb_build_object('amount', p_amount, 'category', p_category, 'fuente', p_fuente, 'op_id', v_op), p_note);

  return jsonb_build_object('expense_id', v_expense_id, 'op_id', v_op);
end;
$$;

-- ============================================================================
--  RPC · registrar_compra (REEMPLAZA 0007/0012: estampa op_id; conserva costo
--    promedio ponderado del 0012). Agrupa inventario + caja bajo un mismo op_id.
-- ============================================================================
create or replace function registrar_compra(
  p_restaurant    uuid,
  p_session       uuid,
  p_user          uuid,
  p_date          date,
  p_ingredient_id uuid,
  p_name          text,
  p_total_cost    numeric,
  p_quantity      numeric default null,
  p_sale_price    numeric default null,
  p_fuente        text default 'caja'
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_kind      text;
  v_unit_lote numeric(12,4);
  v_old_stock numeric(12,4);
  v_old_cost  numeric(12,4);
  v_new_cost  numeric(12,4);
  v_op        uuid := gen_random_uuid();
begin
  select kind, coalesce(last_unit_cost, 0) into v_kind, v_old_cost
  from ingredients where id = p_ingredient_id;

  if p_quantity is not null and p_quantity > 0 and v_kind = 'contable' then
    v_unit_lote := round(p_total_cost / p_quantity, 4);
    -- costo promedio ponderado con el stock vivo
    select coalesce(sum(qty), 0) into v_old_stock
    from inventory_movements
    where ingredient_id = p_ingredient_id and voided_at is null;
    if v_old_stock + p_quantity > 0 then
      v_new_cost := round((v_old_stock * v_old_cost + p_quantity * v_unit_lote) / (v_old_stock + p_quantity), 4);
    else
      v_new_cost := v_unit_lote;
    end if;
    update ingredients set last_unit_cost = v_new_cost where id = p_ingredient_id;
    insert into inventory_movements (restaurant_id, ingredient_id, shift_session_id,
                                     business_date, type, qty, unit_cost, user_id, op_id)
    values (p_restaurant, p_ingredient_id, p_session, p_date, 'compra',
            p_quantity, v_unit_lote, p_user, v_op);
  end if;

  if p_sale_price is not null then
    update ingredients set sale_price = p_sale_price, is_sellable = true
    where id = p_ingredient_id;
  end if;

  if p_fuente = 'jefa' then
    insert into cash_movements (restaurant_id, shift_session_id, user_id, type, amount, reason, op_id)
    values (p_restaurant, p_session, p_user, 'ingreso', p_total_cost, 'Aporte jefa: ' || p_name, v_op);
  end if;
  insert into cash_movements (restaurant_id, shift_session_id, user_id, type, amount, reason, op_id)
  values (p_restaurant, p_session, p_user, 'egreso', p_total_cost, 'Compra: ' || p_name, v_op);

  insert into audit_log (restaurant_id, user_id, shift_session_id, action, entity, entity_id, payload)
  values (p_restaurant, p_user, p_session, 'compra', 'ingredients', p_ingredient_id,
          jsonb_build_object('name', p_name, 'total_cost', p_total_cost,
                             'quantity', p_quantity, 'fuente', p_fuente, 'op_id', v_op));

  return jsonb_build_object('ingredient_id', p_ingredient_id, 'op_id', v_op);
end;
$$;

-- ============================================================================
--  RPC · anular_operacion — marca anulada toda fila con ese op_id (rastro).
--   La caja y el stock se corrigen solos porque las vistas/reportes ignoran lo
--   anulado. Idempotente: si ya estaba anulada (sin filas vivas), lanza error.
-- ============================================================================
create or replace function anular_operacion(
  p_restaurant uuid,
  p_op_id      uuid,
  p_reason     text,
  p_by         uuid
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_total int := 0;
  v_n     int;
begin
  if p_op_id is null then raise exception 'Falta la operación a anular'; end if;

  update sales set voided_at = now(), voided_by = p_by, void_reason = p_reason
   where op_id = p_op_id and restaurant_id = p_restaurant and voided_at is null;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  update expenses set voided_at = now(), voided_by = p_by, void_reason = p_reason
   where op_id = p_op_id and restaurant_id = p_restaurant and voided_at is null;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  update cash_movements set voided_at = now(), voided_by = p_by, void_reason = p_reason
   where op_id = p_op_id and restaurant_id = p_restaurant and voided_at is null;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  update inventory_movements set voided_at = now(), voided_by = p_by, void_reason = p_reason
   where op_id = p_op_id and restaurant_id = p_restaurant and voided_at is null;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  if v_total = 0 then
    raise exception 'La operación no existe o ya fue anulada';
  end if;

  insert into audit_log (restaurant_id, user_id, action, entity, entity_id, payload, reason)
  values (p_restaurant, p_by, 'anulacion', 'operacion', p_op_id,
          jsonb_build_object('op_id', p_op_id, 'rows', v_total), p_reason);

  return jsonb_build_object('op_id', p_op_id, 'voided_rows', v_total);
end;
$$;

-- ============================================================================
--  RPC · editar_producto — edita un contable del inventario en una transacción.
--   Cambia nombre/costo, precio de venta (solo si ya es vendible) y, opcional,
--   ajusta el stock. p_adjust_kind: 'correccion' (no es desfase) | 'ajuste'
--   (conteo físico = posible robo, alimenta el desfase de la analítica).
--   El PIN de admin se valida ANTES en la capa de la app (igual que el ajuste).
-- ============================================================================
create or replace function editar_producto(
  p_restaurant    uuid,
  p_session       uuid,
  p_user          uuid,
  p_date          date,
  p_ingredient_id uuid,
  p_name          text,
  p_unit_cost     numeric,
  p_sale_price    numeric default null,
  p_new_qty       numeric default null,
  p_adjust_kind   text    default 'correccion',
  p_reason        text    default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_ing      ingredients;
  v_stock    numeric(12,4);
  v_diff     numeric(12,4) := 0;
  v_kind     text;
begin
  select * into v_ing from ingredients
   where id = p_ingredient_id and restaurant_id = p_restaurant;
  if v_ing.id is null then raise exception 'Producto no encontrado'; end if;

  update ingredients
     set name           = coalesce(nullif(btrim(p_name), ''), name),
         last_unit_cost = coalesce(p_unit_cost, last_unit_cost),
         sale_price     = case when is_sellable and p_sale_price is not null
                               then p_sale_price else sale_price end
   where id = p_ingredient_id;

  -- ajuste de stock opcional
  if p_new_qty is not null then
    select coalesce(sum(qty), 0) into v_stock
      from inventory_movements
     where ingredient_id = p_ingredient_id and voided_at is null;
    v_diff := p_new_qty - v_stock;
    if abs(v_diff) > 0.0001 then
      v_kind := case when p_adjust_kind = 'ajuste' then 'ajuste' else 'correccion' end;
      insert into inventory_movements (restaurant_id, ingredient_id, shift_session_id,
                                       business_date, type, qty, unit_cost, reason, user_id)
      values (p_restaurant, p_ingredient_id, p_session, p_date, v_kind,
              v_diff, coalesce(p_unit_cost, v_ing.last_unit_cost, 0),
              coalesce(p_reason, 'Edición de producto'), p_user);
      insert into audit_log (restaurant_id, user_id, shift_session_id, action, entity, entity_id, payload, reason)
      values (p_restaurant, p_user, p_session,
              case when v_kind = 'ajuste' then 'ajuste_inventario' else 'correccion_inventario' end,
              'ingredients', p_ingredient_id,
              jsonb_build_object('from', v_stock, 'to', p_new_qty, 'diff', v_diff, 'kind', v_kind), p_reason);
    end if;
  end if;

  return jsonb_build_object(
    'ingredient_id', p_ingredient_id,
    'old_name', v_ing.name, 'new_name', coalesce(nullif(btrim(p_name), ''), v_ing.name),
    'old_cost', v_ing.last_unit_cost, 'new_cost', coalesce(p_unit_cost, v_ing.last_unit_cost),
    'stock_diff', v_diff, 'adjust_kind', v_kind);
end;
$$;

-- ============================================================================
--  RPC · eliminar_producto — borra; si tiene historial (FK), lo desactiva.
--   El PIN de admin se valida en la capa de la app.
-- ============================================================================
create or replace function eliminar_producto(
  p_restaurant    uuid,
  p_ingredient_id uuid
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_name text;
begin
  select name into v_name from ingredients
   where id = p_ingredient_id and restaurant_id = p_restaurant;
  if v_name is null then raise exception 'Producto no encontrado'; end if;

  begin
    delete from ingredients where id = p_ingredient_id and restaurant_id = p_restaurant;
    return jsonb_build_object('name', v_name, 'deleted', true);
  exception when foreign_key_violation then
    update ingredients set active = false
     where id = p_ingredient_id and restaurant_id = p_restaurant;
    return jsonb_build_object('name', v_name, 'deleted', false, 'deactivated', true);
  end;
end;
$$;

-- ============================================================================
--  RPC · operaciones_reversibles — lista operaciones que se pueden anular
--   (de la bitácora, con op_id) marcando si ya están anuladas. Para el módulo
--   /reversar y para que la IA resuelva "anula la última venta".
-- ============================================================================
create or replace function operaciones_reversibles(
  p_restaurant uuid,
  p_from       date,
  p_to         date
) returns jsonb
  language sql
  stable
  security definer
  set search_path = public, app
as $$
  select coalesce(jsonb_agg(t order by t.created_at desc), '[]'::jsonb)
  from (
    select
      l.op_id,
      l.event_code,
      e.label       as event_label,
      e.category    as category,
      l.description,
      l.actor_name,
      l.source,
      l.created_at,
      l.metadata,
      not exists (
        select 1 from sales s
          where s.op_id = l.op_id and s.voided_at is null
        union all
        select 1 from expenses x
          where x.op_id = l.op_id and x.voided_at is null
        union all
        select 1 from cash_movements c
          where c.op_id = l.op_id and c.voided_at is null
        union all
        select 1 from inventory_movements m
          where m.op_id = l.op_id and m.voided_at is null
      ) as anulada
    from activity_log l
    join activity_events e on e.code = l.event_code
    where l.restaurant_id = p_restaurant
      and l.op_id is not null
      and l.event_code in ('venta','compra','gasto','ingreso_caja','egreso_caja')
      and (l.created_at at time zone 'America/Guayaquil')::date >= p_from
      and (l.created_at at time zone 'America/Guayaquil')::date <= p_to
    order by l.created_at desc
    limit 500
  ) t;
$$;

-- ============================================================================
--  Redefinición de agregaciones existentes para IGNORAR lo anulado
-- ============================================================================

-- Caja esperada del turno (0001): excluye ventas/movimientos/gastos anulados
create or replace view v_caja_turno
  with (security_invoker = on) as
select
  ss.id            as shift_session_id,
  ss.restaurant_id,
  ss.opening_cash,
  ss.opening_cash
    + coalesce((select sum(s.total) from sales s
        where s.shift_session_id = ss.id and s.payment_method = 'efectivo' and s.voided_at is null), 0)
    + coalesce((select sum(c.amount) from cash_movements c
        where c.shift_session_id = ss.id and c.type = 'ingreso' and c.voided_at is null), 0)
    - coalesce((select sum(c.amount) from cash_movements c
        where c.shift_session_id = ss.id and c.type = 'egreso' and c.voided_at is null), 0)
    - coalesce((select sum(e.amount) from expenses e
        where e.shift_session_id = ss.id and e.paid_from_cash and e.voided_at is null), 0)
    as caja_esperada
from shift_sessions ss;

-- Stock de contables (0002): excluye movimientos anulados
create or replace view v_stock_contable
  with (security_invoker = on) as
select i.restaurant_id, i.id as ingredient_id, i.name,
       coalesce(sum(m.qty), 0) as stock
from ingredients i
left join inventory_movements m on m.ingredient_id = i.id and m.voided_at is null
where i.kind = 'contable'
group by i.restaurant_id, i.id, i.name;

-- Ventas promedio por día de semana (0006): excluye anuladas
create or replace function ventas_por_dia_semana(p_restaurant uuid)
returns table (weekday int, total numeric, dias bigint)
  language sql
  stable
  security definer
  set search_path = public, app
as $$
  select extract(dow from business_date)::int as weekday,
         coalesce(sum(total), 0)              as total,
         count(distinct business_date)        as dias
  from sales
  where restaurant_id = p_restaurant
    and voided_at is null
  group by 1
  order by 1;
$$;

-- Conteo de cierre (0009): el esperado ignora movimientos anulados
create or replace function registrar_conteo(
  p_restaurant uuid,
  p_session    uuid,
  p_user       uuid,
  p_date       date,
  p_counts     jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  r           record;
  v_expected  numeric(12,4);
  v_diff      numeric(12,4);
  v_unit      numeric(12,4);
  v_name      text;
  v_result    jsonb := '[]'::jsonb;
  v_falta     numeric(12,2) := 0;
begin
  for r in
    select * from jsonb_to_recordset(p_counts)
      as x(ingredient_id uuid, counted_qty numeric, tag text)
  loop
    select coalesce(sum(qty), 0) into v_expected
      from inventory_movements
      where ingredient_id = r.ingredient_id and restaurant_id = p_restaurant
        and voided_at is null;

    select coalesce(last_unit_cost, 0), name into v_unit, v_name
      from ingredients where id = r.ingredient_id;

    v_diff := coalesce(r.counted_qty, 0) - v_expected;

    insert into inventory_counts (restaurant_id, business_date, ingredient_id,
                                  expected_qty, counted_qty, tag)
    values (p_restaurant, p_date, r.ingredient_id, v_expected, coalesce(r.counted_qty, 0),
            case when r.tag in ('merma','error','faltante') then r.tag
                 when v_diff < -0.0001 then 'faltante'
                 else null end)
    on conflict (restaurant_id, business_date, ingredient_id)
    do update set expected_qty = excluded.expected_qty,
                  counted_qty  = excluded.counted_qty,
                  tag          = excluded.tag;

    if abs(v_diff) > 0.0001 then
      insert into inventory_movements (restaurant_id, ingredient_id, shift_session_id,
                                       business_date, type, qty, unit_cost, reason, user_id)
      values (p_restaurant, r.ingredient_id, p_session, p_date, 'ajuste',
              v_diff, v_unit, 'Conteo de cierre', p_user);
      if v_diff < 0 then v_falta := v_falta + abs(v_diff) * v_unit; end if;
    end if;

    v_result := v_result || jsonb_build_object(
      'ingredient_id', r.ingredient_id, 'name', v_name,
      'expected', v_expected, 'counted', coalesce(r.counted_qty, 0),
      'diff', v_diff, 'unit_cost', v_unit,
      'diff_cost', round(v_diff * v_unit, 2));
  end loop;

  insert into audit_log(restaurant_id, user_id, shift_session_id, action, entity, payload)
  values (p_restaurant, p_user, p_session, 'conteo_inventario', 'inventory_counts',
          jsonb_build_object('date', p_date, 'items', v_result, 'faltante_cost', round(v_falta, 2)));

  return jsonb_build_object('date', p_date, 'items', v_result, 'faltante_cost', round(v_falta, 2));
end;
$$;

-- Cerrar día (0002): el conteo de platos del granel ignora ventas anuladas
create or replace function cerrar_dia(
  p_restaurant uuid,
  p_date       date,
  p_merma      jsonb default '{}'::jsonb,
  p_closed_by  uuid default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  r          record;
  v_plates   int;
  v_merma    numeric(5,2);
  v_result   jsonb := '[]'::jsonb;
begin
  for r in
    select pool.ingredient_id, pool.name, pool.pool_cost
    from v_pool_granel pool
    where pool.restaurant_id = p_restaurant and pool.business_date = p_date
  loop
    select coalesce(sum(s.qty), 0) into v_plates
    from sales s
    join dish_components dc on dc.dish_id = s.dish_id
    where s.restaurant_id = p_restaurant
      and s.business_date = p_date
      and s.voided_at is null
      and dc.ingredient_id = r.ingredient_id;

    v_merma := coalesce((p_merma ->> r.ingredient_id::text)::numeric, 0);

    insert into granel_close (restaurant_id, business_date, ingredient_id,
                              pool_cost, plates_count, merma_pct)
    values (p_restaurant, p_date, r.ingredient_id, r.pool_cost, v_plates, v_merma)
    on conflict (restaurant_id, business_date, ingredient_id)
    do update set pool_cost = excluded.pool_cost,
                  plates_count = excluded.plates_count,
                  merma_pct = excluded.merma_pct;

    v_result := v_result || jsonb_build_object(
      'ingredient', r.name, 'pool_cost', r.pool_cost,
      'plates', v_plates, 'merma_pct', v_merma);
  end loop;

  insert into daily_close (restaurant_id, business_date, status, closed_by, closed_at)
  values (p_restaurant, p_date, 'closed', p_closed_by, now())
  on conflict (restaurant_id, business_date)
  do update set status = 'closed', closed_by = p_closed_by, closed_at = now();

  insert into audit_log(restaurant_id, user_id, action, entity, payload)
  values (p_restaurant, p_closed_by, 'cerrar_dia', 'daily_close',
          jsonb_build_object('date', p_date, 'granel', v_result));

  return jsonb_build_object('business_date', p_date, 'granel', v_result);
end;
$$;

-- Resumen del turno (0008): ventas/gastos/egresos/aportes ignoran lo anulado
create or replace function resumen_turno(p_session_id uuid)
returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_ss       shift_sessions;
  v_esperada numeric(12,2);
  v_shift    text;
  v_resp     text;
  v_ventas   jsonb;
  v_gastos   jsonb;
  v_egresos  jsonb;
  v_aportes  numeric(12,2);
begin
  select * into v_ss from shift_sessions where id = p_session_id;
  if v_ss.id is null then
    raise exception 'Sesión % no encontrada', p_session_id;
  end if;

  select caja_esperada into v_esperada from v_caja_turno where shift_session_id = p_session_id;
  select name into v_shift from shifts where id = v_ss.shift_id;
  select name into v_resp  from users  where id = v_ss.responsible_user_id;

  select jsonb_build_object(
    'total',         coalesce(sum(total), 0),
    'efectivo',      coalesce(sum(total) filter (where payment_method = 'efectivo'), 0),
    'transferencia', coalesce(sum(total) filter (where payment_method = 'transferencia'), 0),
    'otro',          coalesce(sum(total) filter (where payment_method = 'otro'), 0),
    'n',             count(*)
  ) into v_ventas
  from sales where shift_session_id = p_session_id and voided_at is null;

  select jsonb_build_object(
    'total', coalesce(sum(amount), 0),
    'items', coalesce(
      jsonb_agg(
        jsonb_build_object('name', coalesce(nullif(btrim(note), ''), category), 'amount', amount)
        order by amount desc
      ), '[]'::jsonb)
  ) into v_gastos
  from expenses where shift_session_id = p_session_id and voided_at is null;

  select jsonb_build_object(
    'total', coalesce(sum(amount) filter (where type = 'egreso'), 0),
    'items', coalesce(
      jsonb_agg(
        jsonb_build_object('reason', reason, 'amount', amount)
        order by amount desc
      ) filter (where type = 'egreso'), '[]'::jsonb)
  ) into v_egresos
  from cash_movements where shift_session_id = p_session_id and voided_at is null;

  select coalesce(sum(amount), 0) into v_aportes
  from cash_movements where shift_session_id = p_session_id and type = 'ingreso' and voided_at is null;

  return jsonb_build_object(
    'session_id',  v_ss.id,
    'shift',       v_shift,
    'responsable', v_resp,
    'ventas',      v_ventas,
    'gastos',      v_gastos,
    'egresos',     v_egresos,
    'aportes',     v_aportes,
    'caja', jsonb_build_object(
      'apertura', v_ss.opening_cash,
      'esperada', coalesce(v_esperada, v_ss.opening_cash)
    )
  );
end;
$$;

-- Cuadres del día (0008): cada subconsulta ignora lo anulado
create or replace function cuadres_dia(p_restaurant uuid, p_date date)
returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_turnos jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(t) order by t.sort_order nulls last, t.opened_at), '[]'::jsonb)
  into v_turnos
  from (
    select
      ss.id,
      sh.name       as shift,
      sh.sort_order,
      ss.opened_at,
      ss.closed_at,
      ss.status,
      ru.name       as responsable,
      cu.name       as cerro_por,
      ss.opening_cash,
      case when ss.status = 'closed' then ss.expected_cash
           else (select caja_esperada from v_caja_turno where shift_session_id = ss.id)
      end           as esperada,
      ss.counted_cash,
      ss.cash_discrepancy,
      ss.closing_float,
      ss.deposit_amount,
      (select coalesce(sum(s.total), 0) from sales s where s.shift_session_id = ss.id and s.voided_at is null) as ventas,
      (select coalesce(sum(s.total), 0) from sales s where s.shift_session_id = ss.id and s.payment_method = 'efectivo' and s.voided_at is null) as ventas_efectivo,
      (select coalesce(sum(e.amount), 0) from expenses e where e.shift_session_id = ss.id and e.voided_at is null) as gastos,
      (select coalesce(sum(c.amount), 0) from cash_movements c where c.shift_session_id = ss.id and c.type = 'egreso' and c.voided_at is null) as egresos,
      (select coalesce(sum(c.amount), 0) from cash_movements c where c.shift_session_id = ss.id and c.type = 'ingreso' and c.voided_at is null) as aportes
    from shift_sessions ss
    join shifts sh on sh.id = ss.shift_id
    left join users ru on ru.id = ss.responsible_user_id
    left join users cu on cu.id = ss.closed_by
    where ss.restaurant_id = p_restaurant
      and ss.business_date = p_date
  ) t;

  return jsonb_build_object('date', p_date, 'turnos', v_turnos);
end;
$$;

-- ----------------------------------------------------------------------------
--  Permisos: solo el servidor (service_role); revocados a anon/authenticated.
-- ----------------------------------------------------------------------------
revoke all on function anular_operacion(uuid, uuid, text, uuid)                                from public;
revoke all on function editar_producto(uuid, uuid, uuid, date, uuid, text, numeric, numeric, numeric, text, text) from public;
revoke all on function eliminar_producto(uuid, uuid)                                           from public;
revoke all on function operaciones_reversibles(uuid, date, date)                               from public;

grant execute on function anular_operacion(uuid, uuid, text, uuid)                             to service_role;
grant execute on function editar_producto(uuid, uuid, uuid, date, uuid, text, numeric, numeric, numeric, text, text) to service_role;
grant execute on function eliminar_producto(uuid, uuid)                                        to service_role;
grant execute on function operaciones_reversibles(uuid, date, date)                            to service_role;

-- ============================================================================
--  RPC · registrar_consumo_interno (comida de empleada = plato a $0 a su nombre)
--   Descuenta la proteína (contables de la receta) y participa del pool (es una
--   venta más para cerrar_dia), pero con total 0 y marca consumo_interno → los
--   reportes lo excluyen del INGRESO y lo muestran como costo "Consumo de
--   empleadas". Reversible por op_id como cualquier venta.
-- ============================================================================
create or replace function registrar_consumo_interno(
  p_restaurant uuid,
  p_session    uuid,
  p_user       uuid,
  p_date       date,
  p_dish_id    uuid,
  p_name       text,
  p_qty        integer default 1
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_sale_id uuid;
  v_op      uuid := gen_random_uuid();
  r         record;
begin
  insert into sales (restaurant_id, shift_session_id, user_id, business_date,
                     item_kind, dish_id, dish_name, qty, unit_price, total,
                     service_type, payment_method, consumo_interno, op_id)
  values (p_restaurant, p_session, p_user, p_date,
          'plato', p_dish_id, p_name, p_qty, 0, 0,
          'servir', 'efectivo', true, v_op)
  returning id into v_sale_id;

  -- Proteína / contables de la receta (el granel va al pool por la venta).
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

  insert into audit_log (restaurant_id, user_id, shift_session_id, action, entity, entity_id, payload)
  values (p_restaurant, p_user, p_session, 'consumo_interno', 'sales', v_sale_id,
          jsonb_build_object('name', p_name, 'qty', p_qty, 'op_id', v_op));

  return jsonb_build_object('sale_id', v_sale_id, 'op_id', v_op);
end;
$$;

revoke all on function registrar_consumo_interno(uuid, uuid, uuid, date, uuid, text, integer) from public;
grant execute on function registrar_consumo_interno(uuid, uuid, uuid, date, uuid, text, integer) to service_role;

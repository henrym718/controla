-- ============================================================================
--  CONTROLA · Migración · COMBO = RECETA EFECTIVA (descuento de inventario vivo)
--
--  Problema (jun-2026, reportado por la dueña): al vender un COMBO no se descuenta
--  del inventario el insumo de receta de sus platos. Causa raíz: el combo guardaba
--  una "foto" (copia) de la suma de recetas de sus partes en sus propios
--  dish_components al momento de armarlo. Si los platos NO tenían receta cuando se
--  armó el combo (o si su receta se editó después), esa foto quedaba vacía u
--  obsoleta → al vender el combo no había nada que descontar.
--
--  Solución: la receta efectiva de un plato pasa a calcularse EN VIVO:
--    · combo  -> suma de las recetas ACTUALES de sus partes (combo_parts).
--    · plato  -> su propia receta.
--  Así, editar la receta de un plato se refleja solo en todos los combos que lo
--  usan. La foto del combo (si existe) deja de usarse para inventario (se ignora,
--  no se cuenta doble).
--
--  PRODUCCIÓN: 100% aditivo. No edita migraciones previas. Solo agrega un helper
--  nuevo y re-crea (create or replace, MISMA firma) las funciones que descuentan
--  inventario por receta, cambiando ÚNICAMENTE la fuente de la receta.
-- ============================================================================

-- ----------------------------------------------------------------------------
--  Helper · recetas_efectivas(p_dish) -> (ingredient_id, qty)
--   La receta que realmente se debe descontar al vender p_dish:
--     · si p_dish es combo  -> suma de las recetas de sus partes (vivo).
--     · si p_dish es plato  -> su propia receta.
--   Las dos ramas son excluyentes: un combo (is_combo=true) tiene combo_parts y
--   queda fuera de la 2da rama; un plato normal no tiene combo_parts.
--   STABLE: se llama dentro de funciones security definer (corre con sus permisos).
-- ----------------------------------------------------------------------------
create or replace function recetas_efectivas(p_dish uuid)
returns table (ingredient_id uuid, qty numeric)
  language sql
  stable
  set search_path = public, app
as $$
  select e.ingredient_id, sum(e.qty)::numeric as qty
  from (
    -- combo: expandir a las recetas vivas de sus partes
    select dc.ingredient_id, dc.qty
    from combo_parts cp
    join dish_components dc on dc.dish_id = cp.part_dish_id
    where cp.combo_dish_id = p_dish

    union all

    -- plato normal: su propia receta (los combos quedan excluidos)
    select dc.ingredient_id, dc.qty
    from dish_components dc
    join dishes d on d.id = dc.dish_id
    where dc.dish_id = p_dish and d.is_combo = false
  ) e
  group by e.ingredient_id;
$$;

revoke all on function recetas_efectivas(uuid) from public;
grant execute on function recetas_efectivas(uuid) to service_role;

-- ============================================================================
--  registrar_venta — venta normal (efectivo/transferencia/otro).
--   Igual que en 0014, solo cambia la fuente de la receta a recetas_efectivas().
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
    -- contables de la receta EFECTIVA (combo -> partes; plato -> su receta)
    for r in
      select re.qty, i.id as ing_id, i.last_unit_cost
      from recetas_efectivas(p_dish_id) re
      join ingredients i on i.id = re.ingredient_id
      where i.kind = 'contable'
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
--  registrar_venta_credito — venta a crédito (fiado). Igual que en 0003, solo
--   cambia la fuente de la receta a recetas_efectivas().
-- ============================================================================
create or replace function registrar_venta_credito(
  p_restaurant     uuid,
  p_session        uuid,
  p_user           uuid,
  p_date           date,
  p_cliente_id     uuid,
  p_item_kind      text,
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
    -- contables de la receta EFECTIVA (el granel se prorratea al cierre del día)
    for r in
      select re.qty, i.id as ing_id, i.last_unit_cost
      from recetas_efectivas(p_dish_id) re
      join ingredients i on i.id = re.ingredient_id
      where i.kind = 'contable'
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
--  cobrar_cuenta_mesa — cobra una cuenta de mesa (borrador -> ventas reales).
--   Igual que en 0004, solo cambia la fuente de la receta a recetas_efectivas().
-- ============================================================================
create or replace function cobrar_cuenta_mesa(
  p_restaurant     uuid,
  p_session        uuid,
  p_user           uuid,
  p_date           date,
  p_cuenta_id      uuid,
  p_payment_method text default 'efectivo'
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
        select re.qty, i.id as ing_id, i.last_unit_cost
        from recetas_efectivas(it.ref_id) re
        join ingredients i on i.id = re.ingredient_id
        where i.kind = 'contable'
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

-- ============================================================================
--  registrar_consumo_interno — consumo del empleado. Igual que en 0014, solo
--   cambia la fuente de la receta a recetas_efectivas().
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

  -- Proteína / contables de la receta EFECTIVA (el granel va al pool por la venta).
  for r in
    select re.qty, i.id as ing_id, i.last_unit_cost
    from recetas_efectivas(p_dish_id) re
    join ingredients i on i.id = re.ingredient_id
    where i.kind = 'contable'
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

-- ============================================================================
--  cerrar_dia — prorrateo del granel al cierre. Igual que en 0014, solo cambia
--   el conteo de platos para que un COMBO también cuente para el pool de granel
--   de sus partes (usa recetas_efectivas en vez de leer dish_components del combo).
-- ============================================================================
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
    -- platos vendidos ese día cuya receta EFECTIVA usa este insumo granel
    -- (incluye combos, que se expanden a las recetas de sus partes).
    select coalesce(sum(s.qty), 0) into v_plates
    from sales s
    where s.restaurant_id = p_restaurant
      and s.business_date = p_date
      and s.voided_at is null
      and exists (
        select 1 from recetas_efectivas(s.dish_id) re
        where re.ingredient_id = r.ingredient_id
      );

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

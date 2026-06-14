-- ============================================================================
--  CONTROLA · Migración 0009 · CONTEO DE CIERRE (anti-robo de unidades) + PROCESAR
--
--  #2 CONTEO DE CIERRE: la responsable cuenta físicamente los CONTABLES al cerrar.
--     El sistema sabe cuánto DEBERÍA haber (stock = suma de movimientos), guarda
--     esperado vs contado en inventory_counts, realinea el stock con un 'ajuste' y
--     valora el faltante en $ (eso alimenta el "desfase de inventario" de Analítica).
--     Faltante = posible venta NO registrada / robo.
--
--  #1 PROCESAR: convierte un insumo CRUDO contable en otro (pollo→presa, dedo→tortilla)
--     CONSUMIENDO el stock crudo y HEREDANDO su costo (no se teclea el costo a mano).
--     Salida con unidades = contable (tanda, costo exacto); sin unidades = granel (pool).
-- ============================================================================

-- ============================================================================
--  RPC · registrar_conteo — conteo físico de contables al cierre
--   p_counts = [{ "ingredient_id":"…", "counted_qty": 12, "tag": "merma"|null }, …]
-- ============================================================================
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
    -- stock esperado AHORA = suma de todos los movimientos del contable
    select coalesce(sum(qty), 0) into v_expected
      from inventory_movements
      where ingredient_id = r.ingredient_id and restaurant_id = p_restaurant;

    select coalesce(last_unit_cost, 0), name into v_unit, v_name
      from ingredients where id = r.ingredient_id;

    v_diff := coalesce(r.counted_qty, 0) - v_expected;

    -- registrar el conteo (histórico/reporte)
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

    -- realinear el stock al conteo real (ajuste) y valorar el faltante
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

-- ============================================================================
--  RPC · conteo_estado — estado del conteo de un día (para la pantalla)
--   Si YA se contó ese día → devuelve lo registrado (locked=true).
--   Si no → lista los contables activos con su stock actual como "esperado".
-- ============================================================================
create or replace function conteo_estado(p_restaurant uuid, p_date date)
returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_locked boolean;
  v_items  jsonb;
begin
  select exists(
    select 1 from inventory_counts
    where restaurant_id = p_restaurant and business_date = p_date
  ) into v_locked;

  if v_locked then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.name), '[]'::jsonb) into v_items
    from (
      select i.id as ingredient_id, i.name, i.consumption_unit as unit,
             ic.expected_qty as expected, ic.counted_qty as counted, ic.diff,
             coalesce(i.last_unit_cost, 0) as unit_cost,
             round(ic.diff * coalesce(i.last_unit_cost, 0), 2) as diff_cost, ic.tag
      from inventory_counts ic
      join ingredients i on i.id = ic.ingredient_id
      where ic.restaurant_id = p_restaurant and ic.business_date = p_date
    ) t;
  else
    select coalesce(jsonb_agg(to_jsonb(t) order by t.name), '[]'::jsonb) into v_items
    from (
      select i.id as ingredient_id, i.name, i.consumption_unit as unit,
             coalesce(st.stock, 0) as expected, null::numeric as counted,
             null::numeric as diff, coalesce(i.last_unit_cost, 0) as unit_cost,
             null::numeric as diff_cost, null::text as tag
      from ingredients i
      left join v_stock_contable st on st.ingredient_id = i.id
      where i.restaurant_id = p_restaurant and i.kind = 'contable' and i.active
    ) t;
  end if;

  return jsonb_build_object('date', p_date, 'locked', v_locked, 'items', v_items);
end;
$$;

-- ============================================================================
--  RPC · procesar_insumo — consume un crudo contable y produce otro insumo
--   Hereda el costo del crudo (no se teclea). Salida con unidades = contable
--   (tanda, costo exacto por unidad); sin unidades = granel (entra al pool del día).
-- ============================================================================
create or replace function procesar_insumo(
  p_restaurant   uuid,
  p_session      uuid,
  p_user         uuid,
  p_date         date,
  p_input_id     uuid,
  p_input_qty    numeric,
  p_output_id    uuid,
  p_output_units numeric default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_in       ingredients;
  v_out      ingredients;
  v_unit_in  numeric(12,4);
  v_cost     numeric(12,2);
  v_batch    uuid;
  v_out_unit numeric(12,4);
begin
  select * into v_in  from ingredients where id = p_input_id  and restaurant_id = p_restaurant;
  select * into v_out from ingredients where id = p_output_id and restaurant_id = p_restaurant;
  if v_in.id is null or v_out.id is null then
    raise exception 'Insumo de entrada o salida no encontrado';
  end if;
  if v_in.kind <> 'contable' then
    raise exception '% no es contable: no se puede consumir por unidades', v_in.name;
  end if;

  v_unit_in := coalesce(v_in.last_unit_cost, 0);
  v_cost := round(p_input_qty * v_unit_in, 2);   -- el costo de la salida = lo consumido

  -- tanda de la SALIDA (contable si trae unidades; granel → pool si no)
  insert into production_batches (restaurant_id, ingredient_id, shift_session_id,
                                  business_date, user_id, total_cost, units_produced, note)
  values (p_restaurant, p_output_id, p_session, p_date, p_user, v_cost, p_output_units,
          'procesado desde ' || v_in.name)
  returning id into v_batch;

  -- consumir el CRUDO del stock (movimiento negativo; no es costo, solo baja stock)
  insert into inventory_movements (restaurant_id, ingredient_id, shift_session_id,
                                   business_date, type, qty, unit_cost, reason, user_id,
                                   ref_table, ref_id)
  values (p_restaurant, p_input_id, p_session, p_date, 'produccion',
          -p_input_qty, v_unit_in, 'procesado → ' || v_out.name, p_user,
          'production_batches', v_batch);

  -- si la salida es contable (unidades), sube su stock y fija su costo unitario
  if p_output_units is not null and p_output_units > 0 then
    v_out_unit := round(v_cost / p_output_units, 4);
    update ingredients set last_unit_cost = v_out_unit where id = p_output_id;
    insert into inventory_movements (restaurant_id, ingredient_id, shift_session_id,
                                     business_date, type, qty, unit_cost, user_id,
                                     ref_table, ref_id)
    values (p_restaurant, p_output_id, p_session, p_date, 'produccion',
            p_output_units, v_out_unit, p_user, 'production_batches', v_batch);
  end if;

  insert into audit_log(restaurant_id, user_id, shift_session_id, action, entity, entity_id, payload)
  values (p_restaurant, p_user, p_session, 'procesar', 'production_batches', v_batch,
          jsonb_build_object('input', v_in.name, 'input_qty', p_input_qty,
                             'output', v_out.name, 'units', p_output_units, 'cost', v_cost));

  return jsonb_build_object('batch_id', v_batch, 'output', v_out.name,
                            'units', p_output_units, 'cost', v_cost,
                            'unit_cost', v_out_unit);
end;
$$;

-- ----------------------------------------------------------------------------
--  Permisos: solo el servidor (service_role).
-- ----------------------------------------------------------------------------
revoke execute on function registrar_conteo(uuid, uuid, uuid, date, jsonb)          from public;
revoke execute on function conteo_estado(uuid, date)                                 from public;
revoke execute on function procesar_insumo(uuid, uuid, uuid, date, uuid, numeric, uuid, numeric) from public;

grant execute on function registrar_conteo(uuid, uuid, uuid, date, jsonb)          to service_role;
grant execute on function conteo_estado(uuid, date)                                 to service_role;
grant execute on function procesar_insumo(uuid, uuid, uuid, date, uuid, numeric, uuid, numeric) to service_role;

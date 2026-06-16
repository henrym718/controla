-- ============================================================================
--  CONTROLA · Migración 0016 · CONSUMO MANUAL DE LA COCINERA + MERMA DE PLATOS
--
--  Pedido del usuario: la cocinera registra lo que GASTÓ hoy para cocinar
--  (tomate, pimiento, arroz…) por CANTIDAD + UNIDAD, y el sistema valora el
--  costo con el costo guardado por unidad (last_unit_cost). NO toca lo que ya
--  se descuenta solo por venta (presa de pollo, huevo del huevo frito) para
--  evitar doble conteo y falso robo.
--
--  (1) ingredients.consumo_visible: el ADMIN decide qué insumos puede registrar
--      la cocinera en consumo. Default: granel sí (es el pool), contable no
--      (se descuenta por venta). El admin activa excepciones (ej. el huevo,
--      que también se cocina aparte del huevo frito).
--
--  (2) registrar_consumo: por cada insumo {ingredient_id, qty} suma su costo
--      (qty × last_unit_cost) al costo del día vía production_batches (pool del
--      día / "insumos cocinados"); si es CONTABLE además baja su stock. Una sola
--      llamada por carrito.
--
--  (3) registrar_merma_platos: el ADMIN, al cerrar el día, declara los platos
--      PREPARADOS que NO se vendieron ("se perdieron 2 sopas, 4 arroces") → baja
--      del inventario la proteína/contables de su receta como MERMA (op_id
--      reversible). Resuelve las presas cocidas que sobraron y se botan.
-- ============================================================================

-- ----------------------------------------------------------------------------
--  (1) Flag: ¿la cocinera puede registrar este insumo en "consumo"?
-- ----------------------------------------------------------------------------
alter table ingredients
  add column if not exists consumo_visible boolean not null default false;

-- Default razonable: el granel (pool) sí; el contable no (se descuenta por venta).
update ingredients set consumo_visible = true
  where kind = 'granel' and consumo_visible = false;

-- ============================================================================
--  (2) RPC · registrar_consumo — carrito de insumos gastados hoy para cocinar.
--   Por insumo: costo = qty × last_unit_cost → production_batches (pool del día).
--   Si es CONTABLE, además baja stock con inventory_movements 'produccion'.
--   Hereda el costo del inventario: NO se pregunta el costo.
-- ============================================================================
create or replace function registrar_consumo(
  p_restaurant uuid,
  p_session    uuid,
  p_user       uuid,
  p_date       date,
  p_items      jsonb            -- [{ "ingredient_id": "...", "qty": 5 }, ...]
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_total numeric(12,2) := 0;
  v_count int := 0;
  it      record;
  v_kind  text;
  v_cost  numeric(12,4);
  v_line  numeric(12,2);
  v_batch uuid;
begin
  for it in
    select * from jsonb_to_recordset(p_items) as x(ingredient_id uuid, qty numeric)
  loop
    if it.qty is null or it.qty <= 0 then continue; end if;

    select kind, coalesce(last_unit_cost, 0) into v_kind, v_cost
    from ingredients
    where id = it.ingredient_id and restaurant_id = p_restaurant;
    if v_kind is null then continue; end if;

    v_line := round(v_cost * it.qty, 2);

    -- Costo del día (pool / "insumos cocinados").
    insert into production_batches (restaurant_id, ingredient_id, shift_session_id,
                                    business_date, user_id, total_cost, units_produced, note)
    values (p_restaurant, it.ingredient_id, p_session, p_date, p_user,
            v_line, null, 'Consumo del día')
    returning id into v_batch;

    -- Si es contable, baja su stock (no se recuenta como costo: el batch ya lo cuenta).
    if v_kind = 'contable' then
      insert into inventory_movements (restaurant_id, ingredient_id, shift_session_id,
                                       business_date, type, qty, unit_cost, ref_table, ref_id)
      values (p_restaurant, it.ingredient_id, p_session, p_date, 'produccion',
              -it.qty, v_cost, 'production_batches', v_batch);
    end if;

    v_total := v_total + v_line;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'No hay insumos que registrar';
  end if;

  insert into audit_log (restaurant_id, user_id, shift_session_id, action, entity, payload)
  values (p_restaurant, p_user, p_session, 'consumo', 'production_batches',
          jsonb_build_object('total', v_total, 'items', v_count));

  return jsonb_build_object('total', v_total, 'count', v_count);
end;
$$;

-- ============================================================================
--  (3) RPC · registrar_merma_platos — platos preparados que NO se vendieron.
--   Por plato {dish_id, qty}: baja como MERMA los CONTABLES de su receta
--   (la proteína: presa de pollo, etc.) × qty. El granel desperdiciado ya lo
--   absorbe la merma% del pool al cerrar. op_id para poder anularlo.
-- ============================================================================
create or replace function registrar_merma_platos(
  p_restaurant uuid,
  p_session    uuid,
  p_user       uuid,
  p_date       date,
  p_items      jsonb            -- [{ "dish_id": "...", "qty": 2 }, ...]
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_op     uuid := gen_random_uuid();
  v_total  numeric(12,2) := 0;
  v_platos int := 0;
  it       record;
  r        record;
begin
  for it in
    select * from jsonb_to_recordset(p_items) as x(dish_id uuid, qty numeric)
  loop
    if it.qty is null or it.qty <= 0 then continue; end if;

    for r in
      select dc.qty as recipe_qty, i.id as ing_id, coalesce(i.last_unit_cost, 0) as cost
      from dish_components dc
      join ingredients i on i.id = dc.ingredient_id
      where dc.dish_id = it.dish_id and i.kind = 'contable'
    loop
      insert into inventory_movements (restaurant_id, ingredient_id, shift_session_id,
                                       business_date, type, qty, unit_cost, reason, user_id, op_id)
      values (p_restaurant, r.ing_id, p_session, p_date, 'merma',
              -(r.recipe_qty * it.qty), r.cost, 'Plato preparado no vendido', p_user, v_op);
      v_total := v_total + round(r.recipe_qty * it.qty * r.cost, 2);
    end loop;

    v_platos := v_platos + it.qty::int;
  end loop;

  if v_platos = 0 then
    raise exception 'No hay platos que registrar';
  end if;

  insert into audit_log (restaurant_id, user_id, shift_session_id, action, entity, entity_id, payload)
  values (p_restaurant, p_user, p_session, 'merma', 'sales', null,
          jsonb_build_object('op_id', v_op, 'platos', v_platos, 'costo', v_total));

  return jsonb_build_object('op_id', v_op, 'platos', v_platos, 'total', v_total);
end;
$$;

-- ----------------------------------------------------------------------------
--  Permisos: solo el servidor (service_role).
-- ----------------------------------------------------------------------------
revoke all on function registrar_consumo(uuid, uuid, uuid, date, jsonb)        from public;
revoke all on function registrar_merma_platos(uuid, uuid, uuid, date, jsonb)   from public;
grant execute on function registrar_consumo(uuid, uuid, uuid, date, jsonb)      to service_role;
grant execute on function registrar_merma_platos(uuid, uuid, uuid, date, jsonb) to service_role;

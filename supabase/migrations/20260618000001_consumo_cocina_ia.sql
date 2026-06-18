-- ============================================================================
--  CONTROLA · Migración 0028 · CHATBOT DE CONSUMO DE COCINA (IA por voz)
--
--  Pedido del usuario: un asistente de voz dedicado SOLO al consumo de cocina,
--  aparte del de ventas. Debe ver ÚNICAMENTE los insumos que la cocina puede
--  registrar (con su SALDO y su costo) y poder registrar y CORREGIR consumos,
--  incluyendo cantidades relativas al saldo ("todo el arroz", "la mitad").
--
--  Regla de visibilidad (la MISMA que el módulo manual de consumo, 0016):
--      active = true  AND  is_sellable = false  AND  consumo_visible = true
--   · is_sellable = true  → producto de VENTA (cola, agua): la IA NO lo ve.
--   · consumo_visible      → el admin marcó "Consumo ✓": la cocina lo registra.
--     Cubre el caso del huevo (va en recetas pero también se cocina aparte) y
--     excluye las presas/filetes que ya se autoconsumen al vender el plato.
--
--  (1) cocina_insumos_consumibles: lista filtrada + saldo (stock) + costo +
--      consumido_hoy (neto en la sesión), para que la IA resuelva "todo/la mitad".
--  (2) corregir_consumo: deshace consumo del día por COMPENSACIÓN INVERSA (tanda
--      de costo negativo + movimiento 'correccion' que restaura el stock), con
--      tope en lo consumido hoy. El REGISTRO reusa registrar_consumo (0016).
-- ============================================================================

-- ----------------------------------------------------------------------------
--  (1) Insumos que la cocina puede registrar, con saldo, costo y consumido hoy.
--   Devuelve jsonb (un array) para que la app lo consuma directo (IA + prompt).
--   security definer: lo usa el servidor (service_role) a través del agente.
-- ----------------------------------------------------------------------------
create or replace function cocina_insumos_consumibles(
  p_restaurant uuid,
  p_session    uuid,
  p_date       date
) returns jsonb
  language sql
  stable
  security definer
  set search_path = public, app
as $$
  select coalesce(jsonb_agg(t order by t.name), '[]'::jsonb)
  from (
    select
      i.id,
      i.name,
      i.kind,
      i.consumption_unit                       as unit,
      round(coalesce(i.last_unit_cost, 0), 4)  as cost,
      coalesce(st.stock, 0)                    as stock,
      coalesce(ch.consumido, 0)                as consumido_hoy
    from ingredients i
    left join (
      select m.ingredient_id, sum(m.qty) as stock
      from inventory_movements m
      where m.restaurant_id = p_restaurant and m.voided_at is null
      group by m.ingredient_id
    ) st on st.ingredient_id = i.id
    left join (
      -- Neto consumido HOY por la cocina en esta sesión (consumo − correcciones).
      -- Se identifica por la TANDA asociada (note), no por el tipo de movimiento.
      select m.ingredient_id, -sum(m.qty) as consumido
      from inventory_movements m
      join production_batches pb on pb.id = m.ref_id
      where m.restaurant_id = p_restaurant
        and m.shift_session_id = p_session
        and m.business_date = p_date
        and m.ref_table = 'production_batches'
        and m.voided_at is null
        and pb.note in ('Consumo del día', 'Corrección de consumo')
      group by m.ingredient_id
    ) ch on ch.ingredient_id = i.id
    where i.restaurant_id = p_restaurant
      and i.active = true
      and i.is_sellable = false
      and i.consumo_visible = true
  ) t;
$$;

revoke all on function cocina_insumos_consumibles(uuid, uuid, date)  from public;
grant execute on function cocina_insumos_consumibles(uuid, uuid, date) to service_role;

-- ----------------------------------------------------------------------------
--  (2) Corregir/quitar consumo del día (deshacer un consumo mal registrado).
--   Por insumo {ingredient_id, qty}: qty = cuánto QUITAR de lo consumido hoy.
--    · Tope: no se puede quitar más de lo consumido hoy (no infla el stock).
--    · Costo: tanda de costo NEGATIVO → baja el costo del día (inverso del consumo).
--    · Stock: movimiento 'correccion' (+qty) → restaura el stock; NO cuenta como
--      desfase/robo (igual que la corrección de inventario de 0014).
--   Reutiliza la misma 'note' de tanda para que cuadre con consumido_hoy.
-- ----------------------------------------------------------------------------
create or replace function corregir_consumo(
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
  v_op       uuid := gen_random_uuid();
  v_total    numeric(12,2) := 0;
  v_count    int := 0;
  it         record;
  v_cost     numeric(12,4);
  v_name     text;
  v_consumed numeric(12,4);
  v_qty      numeric(12,4);
  v_line     numeric(12,2);
  v_batch    uuid;
begin
  for it in
    select * from jsonb_to_recordset(p_items) as x(ingredient_id uuid, qty numeric)
  loop
    if it.qty is null or it.qty <= 0 then continue; end if;

    select coalesce(last_unit_cost, 0), name into v_cost, v_name
    from ingredients
    where id = it.ingredient_id and restaurant_id = p_restaurant;
    if v_name is null then continue; end if;

    -- Cuánto se consumió HOY (neto) de este insumo en esta sesión.
    select coalesce(-sum(m.qty), 0) into v_consumed
    from inventory_movements m
    join production_batches pb on pb.id = m.ref_id
    where m.restaurant_id = p_restaurant
      and m.shift_session_id = p_session
      and m.business_date = p_date
      and m.ref_table = 'production_batches'
      and m.voided_at is null
      and pb.note in ('Consumo del día', 'Corrección de consumo')
      and m.ingredient_id = it.ingredient_id;

    -- No se puede corregir más de lo consumido hoy.
    v_qty := least(it.qty, greatest(v_consumed, 0));
    if v_qty <= 0 then continue; end if;

    v_line := round(v_cost * v_qty, 2);

    -- Baja el costo del día (tanda de costo negativo; misma 'note' para cuadrar).
    insert into production_batches (restaurant_id, ingredient_id, shift_session_id,
                                    business_date, user_id, total_cost, units_produced, note)
    values (p_restaurant, it.ingredient_id, p_session, p_date, p_user,
            -v_line, null, 'Corrección de consumo')
    returning id into v_batch;

    -- Restaura el stock (type 'correccion' → no cuenta como desfase/robo).
    insert into inventory_movements (restaurant_id, ingredient_id, shift_session_id,
                                     business_date, type, qty, unit_cost, reason,
                                     ref_table, ref_id, user_id, op_id)
    values (p_restaurant, it.ingredient_id, p_session, p_date, 'correccion',
            v_qty, v_cost, 'Corrección de consumo', 'production_batches', v_batch,
            p_user, v_op);

    v_total := v_total + v_line;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'No hay consumo de hoy para corregir';
  end if;

  insert into audit_log (restaurant_id, user_id, shift_session_id, action, entity, payload)
  values (p_restaurant, p_user, p_session, 'consumo', 'production_batches',
          jsonb_build_object('correccion', true, 'total', v_total, 'items', v_count, 'op_id', v_op));

  return jsonb_build_object('total', v_total, 'count', v_count, 'op_id', v_op);
end;
$$;

revoke all on function corregir_consumo(uuid, uuid, uuid, date, jsonb)  from public;
grant execute on function corregir_consumo(uuid, uuid, uuid, date, jsonb) to service_role;

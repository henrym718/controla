-- ============================================================================
--  CONTROLA · Migración 0012 · COSTO PROMEDIO EN COMPRAS + CONSUMO DEL DÍA
--
--  1) registrar_compra ahora usa COSTO PROMEDIO PONDERADO: al recomprar a otro
--     precio, el last_unit_cost se promedia con el stock que ya había (no se pisa).
--     El movimiento de compra guarda el costo real de ESE lote.
--  2) consumir_insumo: registra un insumo CONTABLE usado HOY para cocinar (sin
--     venderlo ni nombrar un resultado). Baja el stock y manda su costo al pool/
--     costo del día (una "tanda" sin unidades sobre ese mismo insumo).
-- ============================================================================

-- ----------------------------------------------------------------------------
--  registrar_compra (REEMPLAZA la de 0007 — misma firma → conserva permisos)
-- ----------------------------------------------------------------------------
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
  v_old_cost  numeric(12,4);
  v_old_stock numeric(12,4);
  v_lot_unit  numeric(12,4);   -- costo unitario de ESTE lote
  v_avg       numeric(12,4);   -- nuevo costo promedio
begin
  select kind, coalesce(last_unit_cost, 0) into v_kind, v_old_cost
  from ingredients where id = p_ingredient_id;

  -- stock contable: sube stock + COSTO PROMEDIO PONDERADO
  if p_quantity is not null and p_quantity > 0 and v_kind = 'contable' then
    v_lot_unit := round(p_total_cost / p_quantity, 4);

    select coalesce(sum(qty), 0) into v_old_stock
    from inventory_movements where ingredient_id = p_ingredient_id;

    if v_old_stock > 0 then
      v_avg := round(
        (v_old_stock * v_old_cost + p_quantity * v_lot_unit) / (v_old_stock + p_quantity), 4);
    else
      v_avg := v_lot_unit;  -- sin stock previo (o negativo): el costo es el del lote
    end if;

    update ingredients set last_unit_cost = v_avg where id = p_ingredient_id;
    insert into inventory_movements (restaurant_id, ingredient_id, shift_session_id,
                                     business_date, type, qty, unit_cost, user_id)
    values (p_restaurant, p_ingredient_id, p_session, p_date, 'compra',
            p_quantity, v_lot_unit, p_user);  -- el movimiento guarda el costo real del lote
  end if;

  -- producto vendible (solo si lo indican; si ya existía, se respeta su precio)
  if p_sale_price is not null then
    update ingredients set sale_price = p_sale_price, is_sellable = true
    where id = p_ingredient_id;
  end if;

  -- caja: aporte si lo puso la jefa, y siempre el egreso de la compra
  if p_fuente = 'jefa' then
    insert into cash_movements (restaurant_id, shift_session_id, user_id, type, amount, reason)
    values (p_restaurant, p_session, p_user, 'ingreso', p_total_cost, 'Aporte jefa: ' || p_name);
  end if;
  insert into cash_movements (restaurant_id, shift_session_id, user_id, type, amount, reason)
  values (p_restaurant, p_session, p_user, 'egreso', p_total_cost, 'Compra: ' || p_name);

  insert into audit_log (restaurant_id, user_id, shift_session_id, action, entity, entity_id, payload)
  values (p_restaurant, p_user, p_session, 'compra', 'ingredients', p_ingredient_id,
          jsonb_build_object('name', p_name, 'total_cost', p_total_cost,
                             'quantity', p_quantity, 'fuente', p_fuente));

  return jsonb_build_object('ingredient_id', p_ingredient_id);
end;
$$;

-- ----------------------------------------------------------------------------
--  consumir_insumo: insumo contable usado HOY para cocinar → costo del día
-- ----------------------------------------------------------------------------
create or replace function consumir_insumo(
  p_restaurant    uuid,
  p_session       uuid,
  p_user          uuid,
  p_date          date,
  p_ingredient_id uuid,
  p_qty           numeric
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_ing   ingredients;
  v_cost  numeric(12,2);
  v_batch uuid;
begin
  select * into v_ing from ingredients
  where id = p_ingredient_id and restaurant_id = p_restaurant;
  if v_ing.id is null then
    raise exception 'Insumo no encontrado';
  end if;
  if v_ing.kind <> 'contable' then
    raise exception '% es a granel; regístralo como producción/cocción, no como consumo por unidades', v_ing.name;
  end if;

  v_cost := round(p_qty * coalesce(v_ing.last_unit_cost, 0), 2);

  -- el costo entra al pool/costo del día (tanda sin unidades sobre el mismo insumo)
  insert into production_batches (restaurant_id, ingredient_id, shift_session_id,
                                  business_date, user_id, total_cost, units_produced, note)
  values (p_restaurant, p_ingredient_id, p_session, p_date, p_user, v_cost, null, 'consumo del día')
  returning id into v_batch;

  -- baja el stock del contable (movimiento que no se vuelve a contar como costo)
  insert into inventory_movements (restaurant_id, ingredient_id, shift_session_id,
                                   business_date, type, qty, unit_cost, reason, user_id,
                                   ref_table, ref_id)
  values (p_restaurant, p_ingredient_id, p_session, p_date, 'produccion',
          -p_qty, coalesce(v_ing.last_unit_cost, 0), 'consumo del día', p_user,
          'production_batches', v_batch);

  insert into audit_log (restaurant_id, user_id, shift_session_id, action, entity, entity_id, payload)
  values (p_restaurant, p_user, p_session, 'consumo', 'production_batches', v_batch,
          jsonb_build_object('ingredient', v_ing.name, 'qty', p_qty, 'cost', v_cost));

  return jsonb_build_object('ingredient', v_ing.name, 'qty', p_qty, 'cost', v_cost);
end;
$$;

revoke execute on function consumir_insumo(uuid, uuid, uuid, date, uuid, numeric) from public;
grant  execute on function consumir_insumo(uuid, uuid, uuid, date, uuid, numeric) to service_role;

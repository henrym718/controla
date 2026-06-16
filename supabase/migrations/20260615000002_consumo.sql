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
--  (La merma por producto dañado vive en su propia migración 0017.)
-- ============================================================================

-- ----------------------------------------------------------------------------
--  (1) Flag: ¿la cocinera puede registrar este insumo en "consumo"?
-- ----------------------------------------------------------------------------
alter table ingredients
  add column if not exists consumo_visible boolean not null default false;

-- consumo_visible = true  ⟺  "la cocinera lo registra" (granel / pool, con stock)
-- consumo_visible = false ⟺  "se descuenta al vender" (contable, receta)
update ingredients set consumo_visible = true
  where kind = 'granel' and consumo_visible = false;

-- ----------------------------------------------------------------------------
--  Stock de TODOS los insumos (contable + granel) para el inventario. El granel
--  ahora también lleva stock (cantidad), aunque su costo se reparta por pool.
--  (El conteo de cierre sigue usando v_stock_contable: solo lo contable.)
-- ----------------------------------------------------------------------------
create or replace view v_stock_total
  with (security_invoker = on) as
select i.restaurant_id, i.id as ingredient_id, i.name, i.kind,
       coalesce(sum(m.qty), 0) as stock
from ingredients i
left join inventory_movements m on m.ingredient_id = i.id and m.voided_at is null
group by i.restaurant_id, i.id, i.name, i.kind;

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

    -- Costo del día (pool / "insumos cocinados"). El kind del insumo decide si
    -- ese costo se reparte por plato (granel) o es plano (contable).
    insert into production_batches (restaurant_id, ingredient_id, shift_session_id,
                                    business_date, user_id, total_cost, units_produced, note)
    values (p_restaurant, it.ingredient_id, p_session, p_date, p_user,
            v_line, null, 'Consumo del día')
    returning id into v_batch;

    -- Baja el stock del insumo (contable o granel; el batch ya cuenta el costo).
    insert into inventory_movements (restaurant_id, ingredient_id, shift_session_id,
                                     business_date, type, qty, unit_cost, ref_table, ref_id)
    values (p_restaurant, it.ingredient_id, p_session, p_date, 'produccion',
            -it.qty, v_cost, 'production_batches', v_batch);

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
--  RPC · registrar_compra (REEMPLAZA 0014: en el modelo unificado TODO insumo
--   lleva cantidad, así que el GRANEL también suma stock al comprarse. Conserva
--   el costo promedio ponderado y el op_id reversible. Misma firma → mismos
--   grants de 0014. La usa la IA y el módulo manual de compras (caja|jefa).
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
  v_unit_lote numeric(12,4);
  v_old_stock numeric(12,4);
  v_old_cost  numeric(12,4);
  v_new_cost  numeric(12,4);
  v_op        uuid := gen_random_uuid();
begin
  select coalesce(last_unit_cost, 0) into v_old_cost from ingredients where id = p_ingredient_id;

  -- stock + costo promedio ponderado (contable o granel: todo lleva cantidad)
  if p_quantity is not null and p_quantity > 0 then
    v_unit_lote := round(p_total_cost / p_quantity, 4);
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

  -- producto vendible (solo si se indica precio; el módulo manual NO lo toca)
  if p_sale_price is not null then
    update ingredients set sale_price = p_sale_price, is_sellable = true
    where id = p_ingredient_id;
  end if;

  -- caja: si lo puso la jefa, aporta (+) y siempre el egreso de la compra (−)
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

-- ----------------------------------------------------------------------------
--  Permisos: solo el servidor (service_role).
-- ----------------------------------------------------------------------------
revoke all on function registrar_consumo(uuid, uuid, uuid, date, jsonb)        from public;
grant execute on function registrar_consumo(uuid, uuid, uuid, date, jsonb)      to service_role;

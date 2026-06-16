-- ============================================================================
--  CONTROLA · Migración 0017 · MERMA POR PRODUCTO (dar de baja por daño)
--
--  Pedido del usuario: el ADMIN (solo el admin) puede dar de baja un producto
--  del inventario cuando se DAÑÓ / se perdió (un tomate podrido, una cola rota,
--  una presa que no sirve para mañana…). Eso NO es robo ni venta: es MERMA.
--
--  · Es SELECTIVO por producto (no por plato): un plato puede llevar presa +
--    chorizo y solo se dañó la presa. Por eso se elige el insumo exacto.
--  · Va a MERMA: inventory_movements type 'merma' (baja el stock, queda en los
--    reportes de merma / pérdida). NO toca la caja del turno (no hay movimiento
--    de efectivo: el producto ya se había comprado).
--  · Reversible: comparte un op_id y se registra en la bitácora, así el admin
--    puede anularlo desde /reversar si se equivocó.
--
--  Reemplaza el flujo viejo de "merma de platos" (registrar_merma_platos), que
--  era demasiado grueso (bajaba toda la proteína de la receta). Aquí se da de
--  baja el producto puntual.
-- ============================================================================

-- ----------------------------------------------------------------------------
--  RPC · registrar_merma_insumos — carrito de productos dañados / perdidos.
--   Por ítem {ingredient_id, qty, reason}: baja como MERMA ese producto
--   (qty × last_unit_cost). Sirve para CUALQUIER insumo del inventario
--   (contable, granel o de venta). op_id compartido para poder anularlo.
-- ----------------------------------------------------------------------------
create or replace function registrar_merma_insumos(
  p_restaurant uuid,
  p_session    uuid,
  p_user       uuid,
  p_date       date,
  p_items      jsonb            -- [{ "ingredient_id": "...", "qty": 5, "reason": "se dañó" }, ...]
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_op    uuid := gen_random_uuid();
  v_total numeric(12,2) := 0;
  v_count int := 0;
  it      record;
  v_cost  numeric(12,4);
  v_name  text;
begin
  for it in
    select * from jsonb_to_recordset(p_items) as x(ingredient_id uuid, qty numeric, reason text)
  loop
    if it.qty is null or it.qty <= 0 then continue; end if;

    select coalesce(last_unit_cost, 0), name into v_cost, v_name
    from ingredients
    where id = it.ingredient_id and restaurant_id = p_restaurant;
    if v_name is null then continue; end if;

    insert into inventory_movements (restaurant_id, ingredient_id, shift_session_id,
                                     business_date, type, qty, unit_cost, reason, user_id, op_id)
    values (p_restaurant, it.ingredient_id, p_session, p_date, 'merma',
            -it.qty, v_cost, coalesce(nullif(btrim(it.reason), ''), 'Producto dañado'), p_user, v_op);

    v_total := v_total + round(it.qty * v_cost, 2);
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'No hay productos que registrar';
  end if;

  insert into audit_log (restaurant_id, user_id, shift_session_id, action, entity, entity_id, payload)
  values (p_restaurant, p_user, p_session, 'merma', 'inventory_movements', null,
          jsonb_build_object('op_id', v_op, 'items', v_count, 'costo', v_total));

  return jsonb_build_object('op_id', v_op, 'items', v_count, 'total', v_total);
end;
$$;

revoke all on function registrar_merma_insumos(uuid, uuid, uuid, date, jsonb)  from public;
grant execute on function registrar_merma_insumos(uuid, uuid, uuid, date, jsonb) to service_role;

-- ----------------------------------------------------------------------------
--  Hacer la MERMA reversible desde /reversar. Se agrega 'merma' a la lista de
--  eventos anulables (las mermas nuevas se registran en la bitácora con op_id;
--  las viejas sin op_id simplemente no aparecen). anular_operacion ya sabe
--  marcar voided_at en inventory_movements por op_id.
-- ----------------------------------------------------------------------------
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
      and l.event_code in ('venta','compra','gasto','ingreso_caja','egreso_caja','merma')
      and (l.created_at at time zone 'America/Guayaquil')::date >= p_from
      and (l.created_at at time zone 'America/Guayaquil')::date <= p_to
    order by l.created_at desc
    limit 500
  ) t;
$$;

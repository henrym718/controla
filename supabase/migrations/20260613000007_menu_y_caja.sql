-- ============================================================================
--  CONTROLA · Migración 0007 · MENÚ DEL DÍA + VENTA LIGADA A INVENTARIO + CAJA UNIFICADA
--   - daily_menu: qué platos se venden HOY en cada turno (desayuno/almuerzo/cena),
--     con precio confirmado del día (puede diferir del catálogo).
--   - ingredients.is_sellable/sale_price: productos del inventario vendibles directo
--     (cola, agua) que descuentan stock al venderse.
--   - sales.item_kind/ingredient_id: una venta es de un PLATO o de un PRODUCTO.
--   - RPCs (atómicas, rápidas) para las escrituras calientes: registrar_venta,
--     registrar_gasto, registrar_compra, fijar_menu.
--   Modelo de caja UNIFICADO: todo gasto/compra debita la caja del turno. Si lo
--   pagó la jefa aparte, se registra primero un APORTE (+) y luego el egreso (−):
--   neto cero, pero todo pasa por la caja y el cuadre lo ve.
-- ============================================================================

-- ----------------------------------------------------------------------------
--  MENÚ DEL DÍA (por turno). La encargada lo declara al abrir; la admin también.
-- ----------------------------------------------------------------------------
create table daily_menu (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  business_date date not null,
  shift_id      uuid not null references shifts(id),
  dish_id       uuid not null references dishes(id) on delete cascade,
  price         numeric(12,2) not null default 0,   -- precio CONFIRMADO del día
  available     boolean not null default true,       -- false = agotado
  sort_order    int not null default 0,
  created_by    uuid references users(id),
  created_at    timestamptz not null default now(),
  unique (restaurant_id, business_date, shift_id, dish_id)
);
create index idx_daily_menu_lookup on daily_menu(restaurant_id, business_date, shift_id);

alter table daily_menu enable row level security;
create policy daily_menu_all on daily_menu for all
  using (restaurant_id = app.restaurant_id())
  with check (restaurant_id = app.restaurant_id());

-- ----------------------------------------------------------------------------
--  PRODUCTOS VENDIBLES DEL INVENTARIO (cola, agua…): precio de venta + flag
-- ----------------------------------------------------------------------------
alter table ingredients
  add column if not exists is_sellable boolean not null default false,
  add column if not exists sale_price  numeric(12,2);

-- ----------------------------------------------------------------------------
--  VENTA de PLATO o de PRODUCTO de inventario
-- ----------------------------------------------------------------------------
alter table sales
  add column if not exists item_kind       text not null default 'plato',
  add column if not exists ingredient_id   uuid references ingredients(id),
  -- Consumo interno = comida de empleada: plato a $0 a su nombre. Descuenta su
  -- proteína y participa del pool, pero NO es ingreso. Se reporta como costo.
  add column if not exists consumo_interno boolean not null default false;
alter table sales
  add constraint sales_item_kind_chk check (item_kind in ('plato', 'producto'));

-- ============================================================================
--  RPC · registrar_venta
--   Inserta la venta y consume inventario en una sola transacción:
--    - plato:    descuenta los contables de la receta (+ envase si 'llevar').
--    - producto: descuenta su propio stock.
-- ============================================================================
create or replace function registrar_venta(
  p_restaurant     uuid,
  p_session        uuid,
  p_user           uuid,
  p_date           date,
  p_item_kind      text,           -- 'plato' | 'producto'
  p_dish_id        uuid,           -- si plato
  p_ingredient_id  uuid,           -- si producto
  p_name           text,           -- snapshot del nombre
  p_qty            integer,
  p_unit_price     numeric,
  p_service_type   text,           -- 'llevar' | 'servir'
  p_payment_method text,           -- 'efectivo' | 'transferencia' | 'otro'
  p_packaging_id   uuid default null  -- envase concreto para 'llevar'
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_total    numeric(12,2) := round(p_unit_price * p_qty, 2);
  v_sale_id  uuid;
  r          record;
begin
  insert into sales (restaurant_id, shift_session_id, user_id, business_date,
                     item_kind, dish_id, ingredient_id, dish_name, qty,
                     unit_price, total, service_type, payment_method)
  values (p_restaurant, p_session, p_user, p_date,
          p_item_kind, p_dish_id, p_ingredient_id, p_name, p_qty,
          p_unit_price, v_total, p_service_type, p_payment_method)
  returning id into v_sale_id;

  if p_item_kind = 'plato' and p_dish_id is not null then
    -- contables de la receta (granel se prorratea al cierre del día)
    for r in
      select dc.qty, i.id as ing_id, i.last_unit_cost
      from dish_components dc
      join ingredients i on i.id = dc.ingredient_id
      where dc.dish_id = p_dish_id and i.kind = 'contable'
    loop
      insert into inventory_movements (restaurant_id, ingredient_id, shift_session_id,
                                       business_date, type, qty, unit_cost, ref_table, ref_id)
      values (p_restaurant, r.ing_id, p_session, p_date, 'venta',
              -(r.qty * p_qty), coalesce(r.last_unit_cost, 0), 'sales', v_sale_id);
    end loop;

    -- envase para llevar
    if p_service_type = 'llevar' then
      if p_packaging_id is not null then
        insert into inventory_movements (restaurant_id, ingredient_id, shift_session_id,
                                         business_date, type, qty, unit_cost, ref_table, ref_id)
        select p_restaurant, i.id, p_session, p_date, 'venta',
               -p_qty, coalesce(i.last_unit_cost, 0), 'sales', v_sale_id
        from ingredients i where i.id = p_packaging_id;
      else
        for r in
          select tp.ingredient_id, tp.qty_per_order, i.last_unit_cost
          from takeout_packaging tp
          join ingredients i on i.id = tp.ingredient_id
          where tp.restaurant_id = p_restaurant
        loop
          insert into inventory_movements (restaurant_id, ingredient_id, shift_session_id,
                                           business_date, type, qty, unit_cost, ref_table, ref_id)
          values (p_restaurant, r.ingredient_id, p_session, p_date, 'venta',
                  -(r.qty_per_order * p_qty), coalesce(r.last_unit_cost, 0), 'sales', v_sale_id);
        end loop;
      end if;
    end if;

  elsif p_item_kind = 'producto' and p_ingredient_id is not null then
    insert into inventory_movements (restaurant_id, ingredient_id, shift_session_id,
                                     business_date, type, qty, unit_cost, ref_table, ref_id)
    select p_restaurant, i.id, p_session, p_date, 'venta',
           -p_qty, coalesce(i.last_unit_cost, 0), 'sales', v_sale_id
    from ingredients i where i.id = p_ingredient_id;
  end if;

  insert into audit_log (restaurant_id, user_id, shift_session_id, action, entity, entity_id, payload)
  values (p_restaurant, p_user, p_session, 'venta', 'sales', v_sale_id,
          jsonb_build_object('name', p_name, 'qty', p_qty, 'total', v_total,
                             'item_kind', p_item_kind, 'service_type', p_service_type));

  return jsonb_build_object('sale_id', v_sale_id, 'total', v_total);
end;
$$;

-- ============================================================================
--  RPC · registrar_gasto (gasto consumible/servicio = COSTO del día)
--   Modelo unificado: si lo pagó la jefa, primero APORTA a caja (+) y luego el
--   gasto debita caja (−). El gasto SIEMPRE pasa por caja (paid_from_cash=true).
-- ============================================================================
create or replace function registrar_gasto(
  p_restaurant uuid,
  p_session    uuid,
  p_user       uuid,
  p_date       date,
  p_amount     numeric,
  p_category   text,
  p_note       text,
  p_fuente     text             -- 'caja' | 'jefa'
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_expense_id uuid;
begin
  if p_fuente = 'jefa' then
    insert into cash_movements (restaurant_id, shift_session_id, user_id, type, amount, reason)
    values (p_restaurant, p_session, p_user, 'ingreso', p_amount,
            'Aporte jefa: ' || coalesce(p_note, 'gasto'));
  end if;

  insert into expenses (restaurant_id, shift_session_id, user_id, business_date,
                        amount, category, note, paid_from_cash, source)
  values (p_restaurant, p_session, p_user, p_date,
          p_amount, coalesce(p_category, 'otro'), p_note, true, 'manual')
  returning id into v_expense_id;

  insert into audit_log (restaurant_id, user_id, shift_session_id, action, entity, entity_id, payload, reason)
  values (p_restaurant, p_user, p_session, 'gasto', 'expenses', v_expense_id,
          jsonb_build_object('amount', p_amount, 'category', p_category, 'fuente', p_fuente), p_note);

  return jsonb_build_object('expense_id', v_expense_id);
end;
$$;

-- ============================================================================
--  RPC · registrar_compra (entra al INVENTARIO; NO es costo hasta consumirse)
--   El ingrediente ya existe (lo crea/resuelve el servidor y pasa su id).
--   Sube stock contable, actualiza costo/precio y debita caja por la compra.
--   Si lo pagó la jefa: aporte (+) y egreso (−) → neto cero.
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
  p_fuente        text default 'caja'   -- 'caja' | 'jefa'
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_kind text;
  v_unit numeric(12,4);
begin
  select kind into v_kind from ingredients where id = p_ingredient_id;

  -- stock contable + costo unitario
  if p_quantity is not null and p_quantity > 0 and v_kind = 'contable' then
    v_unit := round(p_total_cost / p_quantity, 4);
    update ingredients set last_unit_cost = v_unit where id = p_ingredient_id;
    insert into inventory_movements (restaurant_id, ingredient_id, shift_session_id,
                                     business_date, type, qty, unit_cost, user_id)
    values (p_restaurant, p_ingredient_id, p_session, p_date, 'compra',
            p_quantity, v_unit, p_user);
  end if;

  -- producto vendible
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

-- ============================================================================
--  RPC · fijar_menu (upsert del menú del turno; precio confirmado por ítem)
--   p_items = [{ "dish_id": "...", "price": 2.5, "sort_order": 0 }, ...]
-- ============================================================================
create or replace function fijar_menu(
  p_restaurant uuid,
  p_date       date,
  p_shift      uuid,
  p_user       uuid,
  p_items      jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  r       record;
  v_count int := 0;
begin
  for r in
    select * from jsonb_to_recordset(p_items)
      as x(dish_id uuid, price numeric, sort_order int)
  loop
    insert into daily_menu (restaurant_id, business_date, shift_id, dish_id,
                            price, sort_order, created_by)
    values (p_restaurant, p_date, p_shift, r.dish_id,
            coalesce(r.price, 0), coalesce(r.sort_order, 0), p_user)
    on conflict (restaurant_id, business_date, shift_id, dish_id)
    do update set price = excluded.price, available = true,
                  sort_order = excluded.sort_order;
    v_count := v_count + 1;
  end loop;

  insert into audit_log (restaurant_id, user_id, action, entity, payload)
  values (p_restaurant, p_user, 'fijar_menu', 'daily_menu',
          jsonb_build_object('date', p_date, 'shift', p_shift, 'items', v_count));

  return jsonb_build_object('count', v_count);
end;
$$;

-- ----------------------------------------------------------------------------
--  Permisos: el servidor llama con service_role; se revoca a anon/authenticated.
-- ----------------------------------------------------------------------------
revoke execute on function registrar_venta(uuid, uuid, uuid, date, text, uuid, uuid, text, integer, numeric, text, text, uuid) from public;
revoke execute on function registrar_gasto(uuid, uuid, uuid, date, numeric, text, text, text) from public;
revoke execute on function registrar_compra(uuid, uuid, uuid, date, uuid, text, numeric, numeric, numeric, text) from public;
revoke execute on function fijar_menu(uuid, date, uuid, uuid, jsonb) from public;

grant execute on function registrar_venta(uuid, uuid, uuid, date, text, uuid, uuid, text, integer, numeric, text, text, uuid) to service_role;
grant execute on function registrar_gasto(uuid, uuid, uuid, date, numeric, text, text, text) to service_role;
grant execute on function registrar_compra(uuid, uuid, uuid, date, uuid, text, numeric, numeric, numeric, text) to service_role;
grant execute on function fijar_menu(uuid, date, uuid, uuid, jsonb) to service_role;

-- ============================================================================
--  COMBOS (sopa + segundo) + ADICIONALES
--   Un combo es UN plato más (is_combo) cuya RECETA = unión de la receta de la
--   sopa y la del segundo → participa en ambos pools al cierre (cerrar_dia ya
--   reparte cada pool solo entre los platos cuya receta lleva ese insumo). El
--   precio del combo vive en daily_menu. Adicional = plato chico (is_extra).
-- ============================================================================
alter table dishes
  add column if not exists is_combo boolean not null default false,
  add column if not exists is_extra boolean not null default false,
  -- Categoría del plato individual (para agrupar en el catálogo): segundo/principal o sopa.
  add column if not exists category text not null default 'principal';

create table if not exists combo_parts (
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  combo_dish_id uuid not null references dishes(id) on delete cascade,
  part_dish_id  uuid not null references dishes(id) on delete cascade,
  role          text not null default 'segundo' check (role in ('sopa', 'segundo')),
  primary key (combo_dish_id, part_dish_id)
);
create index if not exists idx_combo_parts_combo on combo_parts(combo_dish_id);

alter table combo_parts enable row level security;
create policy combo_parts_all on combo_parts for all
  using (restaurant_id = app.restaurant_id())
  with check (restaurant_id = app.restaurant_id());

create or replace function crear_combo(
  p_restaurant uuid,
  p_sopa       uuid,
  p_segundo    uuid,
  p_name       text default null,
  p_price      numeric default null,
  p_user       uuid default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_sopa_name text;
  v_seg_name  text;
  v_name      text;
  v_combo     uuid;
begin
  select name into v_sopa_name from dishes
   where id = p_sopa and restaurant_id = p_restaurant;
  select name into v_seg_name from dishes
   where id = p_segundo and restaurant_id = p_restaurant;
  if v_sopa_name is null or v_seg_name is null then
    raise exception 'La sopa o el segundo no existen en este restaurante';
  end if;
  if p_sopa = p_segundo then
    raise exception 'La sopa y el segundo deben ser platos distintos';
  end if;

  v_name := coalesce(nullif(btrim(p_name), ''), 'Combo ' || v_seg_name);

  insert into dishes (restaurant_id, name, price, is_combo)
  values (p_restaurant, v_name, coalesce(p_price, 0), true)
  on conflict (restaurant_id, name)
  do update set is_combo = true,
                active   = true,
                price    = coalesce(p_price, dishes.price)
  returning id into v_combo;

  delete from combo_parts where combo_dish_id = v_combo;
  insert into combo_parts (restaurant_id, combo_dish_id, part_dish_id, role)
  values (p_restaurant, v_combo, p_sopa, 'sopa'),
         (p_restaurant, v_combo, p_segundo, 'segundo');

  delete from dish_components where dish_id = v_combo;
  insert into dish_components (restaurant_id, dish_id, ingredient_id, qty)
  select p_restaurant, v_combo, dc.ingredient_id, sum(dc.qty)
  from dish_components dc
  where dc.dish_id in (p_sopa, p_segundo)
  group by dc.ingredient_id;

  insert into audit_log (restaurant_id, user_id, action, entity, entity_id, payload)
  values (p_restaurant, p_user, 'crear_combo', 'dishes', v_combo,
          jsonb_build_object('name', v_name, 'sopa', v_sopa_name,
                             'segundo', v_seg_name, 'price', p_price));

  return jsonb_build_object('combo_dish_id', v_combo, 'name', v_name);
end;
$$;

revoke execute on function crear_combo(uuid, uuid, uuid, text, numeric, uuid) from public;
grant  execute on function crear_combo(uuid, uuid, uuid, text, numeric, uuid) to service_role;

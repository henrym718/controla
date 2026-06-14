-- ============================================================================
--  CONTROLA · SEED de demostración
--  ⚠️  PINs de ejemplo: CAMBIARLOS antes de usar de verdad.
--  Mientras no exista el dashboard de admin, los restaurantes/PINs se crean aquí.
-- ============================================================================

-- ---- Restaurante demo ------------------------------------------------------
insert into restaurants (id, slug, name)
values ('00000000-0000-0000-0000-000000000001', 'rincon-de-mi-hermana', 'El Rincón de mi Hermana')
on conflict (slug) do nothing;

-- ---- Usuarios (PIN con hash bcrypt) ----------------------------------------
-- admin  -> PIN 1234   |  María (empleada) -> 1111  |  Ana (empleada) -> 2222
insert into users (restaurant_id, name, role, pin_hash) values
  ('00000000-0000-0000-0000-000000000001', 'Administradora', 'admin',    crypt('1234', gen_salt('bf'))),
  ('00000000-0000-0000-0000-000000000001', 'María',          'empleado', crypt('1111', gen_salt('bf'))),
  ('00000000-0000-0000-0000-000000000001', 'Ana',            'empleado', crypt('2222', gen_salt('bf')))
on conflict do nothing;

-- ---- Turnos con ventana horaria (habilitan la IA) --------------------------
insert into shifts (restaurant_id, name, start_time, end_time, sort_order) values
  ('00000000-0000-0000-0000-000000000001', 'Mañana', '06:00', '12:00', 1),
  ('00000000-0000-0000-0000-000000000001', 'Tarde',  '12:00', '18:00', 2),
  ('00000000-0000-0000-0000-000000000001', 'Noche',  '18:00', '23:30', 3)
on conflict (restaurant_id, name) do nothing;

-- ---- Catálogo de platos (la IA lo irá ampliando) ---------------------------
insert into dishes (restaurant_id, name, price) values
  ('00000000-0000-0000-0000-000000000001', 'Arroz con pollo',    2.50),
  ('00000000-0000-0000-0000-000000000001', 'Arroz con menestra', 2.50),
  ('00000000-0000-0000-0000-000000000001', 'Batido',             1.50)
on conflict (restaurant_id, name) do nothing;
-- (La "Cola" NO es un plato: es un producto vendible del inventario; ver más abajo.)

-- ---- Costos recurrentes de ejemplo (incl. sueldo ligado a turno) -----------
insert into recurring_costs (restaurant_id, name, amount, category, schedule_type, day_of_month) values
  ('00000000-0000-0000-0000-000000000001', 'Arriendo',  300.00, 'administrativo', 'monthly', 5),
  ('00000000-0000-0000-0000-000000000001', 'Internet',   25.00, 'administrativo', 'monthly', 10)
on conflict do nothing;

-- sueldo del turno mañana: $15 los días lun-sáb (weekdays 1..6)
insert into recurring_costs (restaurant_id, name, amount, category, shift_id, schedule_type, weekdays)
select '00000000-0000-0000-0000-000000000001', 'Sueldo turno mañana', 15.00, 'operativo',
       s.id, 'weekly', array[1,2,3,4,5,6]
from shifts s
where s.restaurant_id = '00000000-0000-0000-0000-000000000001' and s.name = 'Mañana'
on conflict do nothing;

-- ---- Insumos demo (contable, conversión, granel, descartable) --------------
insert into ingredients (restaurant_id, name, kind, costing_method, consumption_unit, last_unit_cost) values
  ('00000000-0000-0000-0000-000000000001', 'Pollo',  'contable', 'tanda', 'presa',   0),
  ('00000000-0000-0000-0000-000000000001', 'Batido', 'contable', 'tanda', 'bolsita', 0)
on conflict (restaurant_id, name) do nothing;

insert into ingredients (restaurant_id, name, kind, costing_method, purchase_unit, consumption_unit, conversion_factor, last_unit_cost, is_disposable) values
  ('00000000-0000-0000-0000-000000000001', 'Verde',    'contable', 'conversion', 'racima',  'dedo',   50, 0.10, false),
  ('00000000-0000-0000-0000-000000000001', 'Bandeja',  'contable', 'conversion', 'paquete', 'unidad',  1, 0.08, true),
  ('00000000-0000-0000-0000-000000000001', 'Lonchera', 'contable', 'conversion', 'paquete', 'unidad',  1, 0.12, true)
on conflict (restaurant_id, name) do nothing;

-- Cola: PRODUCTO vendible del inventario (se vende directo y descuenta stock).
insert into ingredients (restaurant_id, name, kind, costing_method, purchase_unit, consumption_unit, conversion_factor, last_unit_cost, is_sellable, sale_price) values
  ('00000000-0000-0000-0000-000000000001', 'Cola', 'contable', 'conversion', 'paquete', 'unidad', 12, 0.50, true, 0.75)
on conflict (restaurant_id, name) do nothing;

insert into ingredients (restaurant_id, name, kind, costing_method, last_unit_cost) values
  ('00000000-0000-0000-0000-000000000001', 'Arroz',    'granel', 'pool', 0),
  ('00000000-0000-0000-0000-000000000001', 'Menestra', 'granel', 'pool', 0),
  ('00000000-0000-0000-0000-000000000001', 'Ensalada', 'granel', 'pool', 0)
on conflict (restaurant_id, name) do nothing;

-- ---- Recetas (qué consume cada plato) --------------------------------------
insert into dish_components (restaurant_id, dish_id, ingredient_id, qty)
select '00000000-0000-0000-0000-000000000001', d.id, i.id, v.qty
from (values
  ('Arroz con pollo',    'Pollo',    1),
  ('Arroz con pollo',    'Arroz',    1),
  ('Arroz con pollo',    'Ensalada', 1),
  ('Arroz con menestra', 'Arroz',    1),
  ('Arroz con menestra', 'Menestra', 1),
  ('Arroz con menestra', 'Ensalada', 1),
  ('Batido',             'Batido',   1)
) as v(dish_name, ing_name, qty)
join dishes d      on d.restaurant_id = '00000000-0000-0000-0000-000000000001' and d.name = v.dish_name
join ingredients i on i.restaurant_id = '00000000-0000-0000-0000-000000000001' and i.name = v.ing_name
on conflict (dish_id, ingredient_id) do nothing;

-- ---- Descartable por orden "para llevar" (Bandeja = envase por defecto) -----
--  La Lonchera existe como descartable también; la IA la usa si la nombran.
insert into takeout_packaging (restaurant_id, ingredient_id, qty_per_order)
select '00000000-0000-0000-0000-000000000001', i.id, 1
from ingredients i
where i.restaurant_id = '00000000-0000-0000-0000-000000000001' and i.name = 'Bandeja'
on conflict (restaurant_id, ingredient_id) do nothing;

-- ---- Stock inicial de Cola (24 unidades) -----------------------------------
insert into inventory_movements (restaurant_id, ingredient_id, business_date, type, qty, unit_cost)
select '00000000-0000-0000-0000-000000000001', i.id, current_date, 'compra', 24, 0.50
from ingredients i
where i.restaurant_id = '00000000-0000-0000-0000-000000000001' and i.name = 'Cola'
  and not exists (
    select 1 from inventory_movements m
    where m.ingredient_id = i.id and m.type = 'compra' and m.ref_id is null
  );

-- ---- Menú de ejemplo para el turno Mañana de HOY ---------------------------
--  (la encargada/admin lo redefine por chat o pantalla; precio confirmado del día)
insert into daily_menu (restaurant_id, business_date, shift_id, dish_id, price, sort_order)
select '00000000-0000-0000-0000-000000000001', current_date, s.id, d.id, v.price, v.ord
from (values
  ('Arroz con pollo',    2.50, 1),
  ('Arroz con menestra', 2.50, 2),
  ('Batido',             1.50, 3)
) as v(dish_name, price, ord)
join shifts s on s.restaurant_id = '00000000-0000-0000-0000-000000000001' and s.name = 'Mañana'
join dishes d on d.restaurant_id = '00000000-0000-0000-0000-000000000001' and d.name = v.dish_name
on conflict (restaurant_id, business_date, shift_id, dish_id) do nothing;

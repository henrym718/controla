-- ============================================================================
--  CONTROLA · Migración 0005 · HISTORIAL DE COSTO POR PLATO
--  Al cerrar el día se guarda el costo real (prorrateado) de cada plato vendido,
--  para graficar cómo varía el costo vs. el precio en el tiempo.
-- ============================================================================

create table dish_daily_cost (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  dish_id       uuid not null references dishes(id) on delete cascade,
  business_date date not null,
  unit_cost     numeric(12,4) not null default 0,
  price         numeric(12,2) not null default 0,
  qty           int not null default 0,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, dish_id, business_date)
);
create index idx_ddc_dish on dish_daily_cost(dish_id, business_date);
create index idx_ddc_restaurant on dish_daily_cost(restaurant_id, business_date);

alter table dish_daily_cost enable row level security;
create policy ddc_all on dish_daily_cost for all
  using (restaurant_id = app.restaurant_id())
  with check (restaurant_id = app.restaurant_id());

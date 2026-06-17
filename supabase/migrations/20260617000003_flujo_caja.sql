-- ============================================================================
--  FLUJO DE CAJA DEL NEGOCIO (capital): ingresos/retiros a nivel negocio.
--   - 'ingreso': la jefa/dueña mete plata al negocio.
--   - 'retiro' : se le entrega plata a la dueña (baja el capital, lo "reinicia").
--  Es independiente de la caja del turno (cash_movements): aquí vive el capital
--  acumulado con el que trabaja el negocio día a día. Aditiva, no toca nada viejo.
-- ============================================================================
create table capital_movements (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  user_id       uuid references users(id),          -- quién lo registró
  type          text not null check (type in ('ingreso', 'retiro')),
  amount        numeric(12,2) not null check (amount >= 0),
  reason        text,
  business_date date not null default current_date,
  created_at    timestamptz not null default now()
);
create index idx_capital_restaurant on capital_movements(restaurant_id, business_date);

alter table capital_movements enable row level security;

-- Lectura: cualquiera del restaurante. Escritura: solo admin (capital sensible).
create policy capital_select on capital_movements for select
  using (restaurant_id = app.restaurant_id());
create policy capital_write on capital_movements for all
  using (restaurant_id = app.restaurant_id() and app.user_role() = 'admin')
  with check (restaurant_id = app.restaurant_id() and app.user_role() = 'admin');

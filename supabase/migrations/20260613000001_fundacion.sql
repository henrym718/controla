-- ============================================================================
--  CONTROLA · Migración 0001 · FUNDACIÓN
--  Multi-tenant + Auth por PIN + Turnos + Cierre de turno (caja) + Ventas + Gastos
--  Postgres / Supabase. RLS scoped por restaurant_id (defensa en profundidad;
--  el servidor usa service role para el login).
--  El COSTEO de platos (insumos contable/granel, pools, prorrateo, merma) va en
--  la siguiente migración (0002_costeo).
-- ============================================================================

create extension if not exists pgcrypto;  -- gen_random_uuid(), crypt(), gen_salt()

-- ----------------------------------------------------------------------------
--  Helpers: leen los claims del JWT (restaurant_id, user_id, role)
-- ----------------------------------------------------------------------------
create schema if not exists app;

create or replace function app.jwt() returns jsonb
  language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

create or replace function app.restaurant_id() returns uuid
  language sql stable as $$
  select nullif(app.jwt() ->> 'restaurant_id', '')::uuid;
$$;

create or replace function app.user_id() returns uuid
  language sql stable as $$
  select nullif(app.jwt() ->> 'user_id', '')::uuid;
$$;

create or replace function app.user_role() returns text
  language sql stable as $$
  select app.jwt() ->> 'role';
$$;

-- trigger genérico para updated_at
create or replace function app.touch_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ============================================================================
--  TENANCY
-- ============================================================================
create table restaurants (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,              -- dominio.com/[slug]
  name        text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_restaurants_touch before update on restaurants
  for each row execute function app.touch_updated_at();

-- ============================================================================
--  USUARIOS (auth por PIN; sin email/password)
-- ============================================================================
create table users (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name          text not null,
  pin_hash      text not null,                   -- crypt('1234', gen_salt('bf'))
  role          text not null default 'empleado'
                check (role in ('admin', 'empleado')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- el PIN debe ser único dentro del restaurante (para identificar al loguear).
-- como guardamos hash, la unicidad real se valida en el servidor al crear el PIN.
create index idx_users_restaurant on users(restaurant_id);
create trigger trg_users_touch before update on users
  for each row execute function app.touch_updated_at();

-- ============================================================================
--  TURNOS predefinidos por restaurante (con ventana horaria que habilita la IA)
-- ============================================================================
create table shifts (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  name            text not null,                 -- "Mañana", "Tarde", "Noche"
  start_time      time not null,                 -- ventana de habilitación
  end_time        time not null,                 -- si end < start => cruza medianoche
  sort_order      int  not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (restaurant_id, name)
);
create index idx_shifts_restaurant on shifts(restaurant_id);
create trigger trg_shifts_touch before update on shifts
  for each row execute function app.touch_updated_at();

-- ============================================================================
--  SESIÓN DE TURNO (compartida por las chicas; una encargada; lleva la caja)
--  business_date = día operativo (no calendario, por el turno noche)
-- ============================================================================
create table shift_sessions (
  id                  uuid primary key default gen_random_uuid(),
  restaurant_id       uuid not null references restaurants(id) on delete cascade,
  shift_id            uuid not null references shifts(id),
  business_date       date not null default current_date,
  status              text not null default 'open'
                      check (status in ('open', 'closed')),
  responsible_user_id uuid references users(id),  -- la chica encargada
  opened_by           uuid references users(id),
  opened_at           timestamptz not null default now(),
  opening_cash        numeric(12,2) not null default 0,   -- "¿cuál es tu caja de hoy?"
  expected_cash       numeric(12,2),              -- se calcula al cerrar
  counted_cash        numeric(12,2),              -- lo que cuenta físicamente
  cash_discrepancy    numeric(12,2),              -- counted - expected
  notes               text,
  closed_by           uuid references users(id),
  closed_at           timestamptz
);
create index idx_sessions_restaurant on shift_sessions(restaurant_id);
create index idx_sessions_date on shift_sessions(restaurant_id, business_date);
-- solo UNA sesión abierta por (restaurante, turno, día)
create unique index uq_open_session
  on shift_sessions(restaurant_id, shift_id, business_date)
  where status = 'open';

-- miembros de la sesión (las 2-3 chicas que trabajan ese turno)
create table shift_session_members (
  shift_session_id uuid not null references shift_sessions(id) on delete cascade,
  user_id          uuid not null references users(id),
  joined_at        timestamptz not null default now(),
  primary key (shift_session_id, user_id)
);

-- ============================================================================
--  CATÁLOGO DE PLATOS (reutilizable; la IA lo aprende/rellena)
-- ============================================================================
create table dishes (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name          text not null,
  price         numeric(12,2) not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, name)
);
create index idx_dishes_restaurant on dishes(restaurant_id);
create trigger trg_dishes_touch before update on dishes
  for each row execute function app.touch_updated_at();

-- ============================================================================
--  VENTAS (registradas dentro de una sesión de turno)
-- ============================================================================
create table sales (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references restaurants(id) on delete cascade,
  shift_session_id uuid not null references shift_sessions(id),
  user_id          uuid references users(id),     -- quién la registró
  business_date    date not null default current_date,
  dish_id          uuid references dishes(id),
  dish_name        text,                          -- snapshot por si cambia el catálogo
  qty              int not null default 1 check (qty > 0),
  unit_price       numeric(12,2) not null default 0,
  total            numeric(12,2) not null default 0,
  service_type     text not null default 'servir'
                   check (service_type in ('llevar', 'servir')),
  payment_method   text not null default 'efectivo'
                   check (payment_method in ('efectivo', 'transferencia', 'otro')),
  created_at       timestamptz not null default now()  -- da la franja horaria
);
create index idx_sales_session on sales(shift_session_id);
create index idx_sales_date on sales(restaurant_id, business_date);

-- ============================================================================
--  MOVIMIENTOS DE CAJA manuales (ingresos/egresos no-venta dentro del turno)
-- ============================================================================
create table cash_movements (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references restaurants(id) on delete cascade,
  shift_session_id uuid not null references shift_sessions(id),
  user_id          uuid references users(id),
  type             text not null check (type in ('ingreso', 'egreso')),
  amount           numeric(12,2) not null check (amount >= 0),
  reason           text,                          -- motivo (obligatorio en app)
  created_at       timestamptz not null default now()
);
create index idx_cash_session on cash_movements(shift_session_id);

-- ============================================================================
--  GASTOS (comida del día, servicios, etc.; pueden salir de caja)
-- ============================================================================
create table expenses (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references restaurants(id) on delete cascade,
  shift_session_id  uuid references shift_sessions(id),   -- null = gasto del día / admin
  user_id           uuid references users(id),
  business_date     date not null default current_date,
  amount            numeric(12,2) not null check (amount >= 0),
  category          text not null default 'comida'
                    check (category in ('comida','operativo','administrativo','financiero','otro')),
  note              text,
  paid_from_cash    boolean not null default true,        -- afecta la caja del turno
  source            text not null default 'manual'
                    check (source in ('manual','recurrente')),
  recurring_cost_id uuid,                                 -- fk lógica a recurring_costs
  created_at        timestamptz not null default now()
);
create index idx_expenses_session on expenses(shift_session_id);
create index idx_expenses_date on expenses(restaurant_id, business_date);

-- ============================================================================
--  COSTOS RECURRENTES / FIJOS (arriendo, internet, energía, SUELDOS por turno…)
--  Sueldo: category 'operativo' + shift_id + weekdays + amount por ocurrencia.
-- ============================================================================
create table recurring_costs (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name          text not null,                   -- "Sueldo turno mañana", "Arriendo"
  amount        numeric(12,2) not null,
  category      text not null default 'operativo'
                check (category in ('operativo','administrativo','financiero')),
  shift_id      uuid references shifts(id),       -- para sueldos ligados a un turno
  schedule_type text not null default 'monthly'
                check (schedule_type in ('daily','weekly','monthly')),
  weekdays      int[],                            -- 0=domingo … 6=sábado (si weekly)
  day_of_month  int check (day_of_month between 1 and 31),  -- si monthly
  next_run      date,                             -- próxima ejecución (worker fase 3)
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_recurring_restaurant on recurring_costs(restaurant_id);
create trigger trg_recurring_touch before update on recurring_costs
  for each row execute function app.touch_updated_at();

-- ============================================================================
--  BITÁCORA / AUDITORÍA (quién, qué, por qué, cuándo)
-- ============================================================================
create table audit_log (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references restaurants(id) on delete cascade,
  user_id          uuid references users(id),
  shift_session_id uuid references shift_sessions(id),
  action           text not null,                 -- 'venta','gasto','retiro','cerrar_turno'…
  entity           text,
  entity_id        uuid,
  payload          jsonb,
  reason           text,
  created_at       timestamptz not null default now()
);
create index idx_audit_restaurant on audit_log(restaurant_id, created_at);

-- ============================================================================
--  CAJA ESPERADA del turno (en vivo): apertura + ventas efectivo + ingresos
--                                     - egresos - gastos pagados de caja
-- ============================================================================
create or replace view v_caja_turno
  with (security_invoker = on) as
select
  ss.id            as shift_session_id,
  ss.restaurant_id,
  ss.opening_cash,
  ss.opening_cash
    + coalesce((select sum(s.total) from sales s
        where s.shift_session_id = ss.id and s.payment_method = 'efectivo'), 0)
    + coalesce((select sum(c.amount) from cash_movements c
        where c.shift_session_id = ss.id and c.type = 'ingreso'), 0)
    - coalesce((select sum(c.amount) from cash_movements c
        where c.shift_session_id = ss.id and c.type = 'egreso'), 0)
    - coalesce((select sum(e.amount) from expenses e
        where e.shift_session_id = ss.id and e.paid_from_cash), 0)
    as caja_esperada
from shift_sessions ss;

-- ============================================================================
--  CERRAR TURNO: calcula caja esperada, guarda lo contado y el descuadre,
--  marca la sesión como cerrada (cierra para TODAS las miembros).
--  El "log out" de las usuarias lo fuerza la app al detectar status='closed'.
-- ============================================================================
create or replace function cerrar_turno(
  p_session_id  uuid,
  p_counted_cash numeric,
  p_closed_by   uuid
) returns shift_sessions
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_expected numeric(12,2);
  v_row      shift_sessions;
begin
  select caja_esperada into v_expected
    from v_caja_turno where shift_session_id = p_session_id;

  update shift_sessions
     set status           = 'closed',
         expected_cash    = coalesce(v_expected, opening_cash),
         counted_cash     = p_counted_cash,
         cash_discrepancy = p_counted_cash - coalesce(v_expected, opening_cash),
         closed_by        = p_closed_by,
         closed_at        = now()
   where id = p_session_id
     and status = 'open'
   returning * into v_row;

  if v_row.id is null then
    raise exception 'La sesión % no existe o ya está cerrada', p_session_id;
  end if;

  insert into audit_log(restaurant_id, user_id, shift_session_id, action, entity, entity_id, payload)
  values (v_row.restaurant_id, p_closed_by, v_row.id, 'cerrar_turno', 'shift_session', v_row.id,
          jsonb_build_object('expected', v_row.expected_cash,
                             'counted', v_row.counted_cash,
                             'discrepancy', v_row.cash_discrepancy));
  return v_row;
end;
$$;

-- ============================================================================
--  RLS · todo scoped por restaurant_id. Config sensible = solo admin escribe.
-- ============================================================================
alter table restaurants          enable row level security;
alter table users                enable row level security;
alter table shifts               enable row level security;
alter table shift_sessions       enable row level security;
alter table shift_session_members enable row level security;
alter table dishes               enable row level security;
alter table sales                enable row level security;
alter table cash_movements       enable row level security;
alter table expenses             enable row level security;
alter table recurring_costs      enable row level security;
alter table audit_log            enable row level security;

-- restaurants: cada quien ve solo el suyo
create policy r_select on restaurants for select
  using (id = app.restaurant_id());

-- usuarios: admin ve a todos los de su restaurante; empleado solo a sí mismo.
-- (el login se hace en el servidor con service role, que ignora RLS)
create policy u_select on users for select
  using (restaurant_id = app.restaurant_id()
         and (app.user_role() = 'admin' or id = app.user_id()));

-- helper de política: misma tienda (lectura/escritura genérica)
-- tablas operativas: cualquiera del restaurante puede leer/escribir su tienda
create policy shifts_all on shifts for all
  using (restaurant_id = app.restaurant_id())
  with check (restaurant_id = app.restaurant_id());

create policy sessions_all on shift_sessions for all
  using (restaurant_id = app.restaurant_id())
  with check (restaurant_id = app.restaurant_id());

create policy members_all on shift_session_members for all
  using (exists (select 1 from shift_sessions s
                 where s.id = shift_session_id and s.restaurant_id = app.restaurant_id()))
  with check (exists (select 1 from shift_sessions s
                 where s.id = shift_session_id and s.restaurant_id = app.restaurant_id()));

create policy dishes_all on dishes for all
  using (restaurant_id = app.restaurant_id())
  with check (restaurant_id = app.restaurant_id());

create policy sales_all on sales for all
  using (restaurant_id = app.restaurant_id())
  with check (restaurant_id = app.restaurant_id());

create policy cash_all on cash_movements for all
  using (restaurant_id = app.restaurant_id())
  with check (restaurant_id = app.restaurant_id());

create policy expenses_all on expenses for all
  using (restaurant_id = app.restaurant_id())
  with check (restaurant_id = app.restaurant_id());

create policy audit_select on audit_log for select
  using (restaurant_id = app.restaurant_id());
create policy audit_insert on audit_log for insert
  with check (restaurant_id = app.restaurant_id());

-- recurring_costs: lectura de la tienda; escritura solo admin (config sensible)
create policy recurring_select on recurring_costs for select
  using (restaurant_id = app.restaurant_id());
create policy recurring_write on recurring_costs for all
  using (restaurant_id = app.restaurant_id() and app.user_role() = 'admin')
  with check (restaurant_id = app.restaurant_id() and app.user_role() = 'admin');

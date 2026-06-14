-- ============================================================================
--  CONTROLA · Migración 0002 · COSTEO
--  El corazón del producto:
--   - Insumos CONTABLES (unidades que se cuentan)  vs  GRANEL (pool de costo).
--   - Recetas reutilizables (dish_components) que la IA aprende.
--   - Tandas de producción, inventario de contables, descartables para llevar.
--   - CIERRE DIARIO: prorrateo del granel + merma + conteo físico de contables.
--  Recordatorio del modelo:
--   * Costo del DÍA = exacto (todo lo consumido).
--   * Costo por PLATO = asignación (presa exacta + prorrateo del granel al cierre).
-- ============================================================================

-- ----------------------------------------------------------------------------
--  INSUMOS
--   kind = 'contable'  -> se cuenta en unidades (presa, dedo, bolsita, vaso…)
--   kind = 'granel'    -> no se cuentan porciones (arroz, sopa, menestra…) -> pool
--   costing_method:
--     'tanda'      -> contable; costo unitario sale de la tanda (pollo->presas)
--     'conversion' -> contable; costo unitario = costo_compra / factor (racima->dedo)
--     'pool'       -> granel; costo va a un pool diario y se prorratea al cierre
-- ----------------------------------------------------------------------------
create table ingredients (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references restaurants(id) on delete cascade,
  name              text not null,
  kind              text not null check (kind in ('contable','granel')),
  costing_method    text not null check (costing_method in ('tanda','conversion','pool')),
  purchase_unit     text,                       -- 'racima','libra','kilo','paquete'
  consumption_unit  text,                       -- 'dedo','presa','bolsita','unidad'
  conversion_factor numeric(12,4),              -- unidades de consumo por unidad de compra
  last_unit_cost    numeric(12,4) default 0,    -- último costo unitario (estimado en vivo)
  is_disposable     boolean not null default false,  -- descartable (bandeja, vaso, cuchara)
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (restaurant_id, name),
  -- coherencia kind <-> método
  check ((kind = 'granel' and costing_method = 'pool')
      or (kind = 'contable' and costing_method in ('tanda','conversion')))
);
create index idx_ingredients_restaurant on ingredients(restaurant_id);
create trigger trg_ingredients_touch before update on ingredients
  for each row execute function app.touch_updated_at();

-- ----------------------------------------------------------------------------
--  RECETA DEL PLATO (reutilizable; la IA la va completando)
--   contable -> qty = unidades por plato (1 presa, 2 dedos de verde…)
--   granel   -> qty = "peso" de participación en el pool (default 1)
-- ----------------------------------------------------------------------------
create table dish_components (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  dish_id       uuid not null references dishes(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id),
  qty           numeric(12,4) not null default 1,
  created_at    timestamptz not null default now(),
  unique (dish_id, ingredient_id)
);
create index idx_dishcomp_dish on dish_components(dish_id);
create index idx_dishcomp_restaurant on dish_components(restaurant_id);

-- ----------------------------------------------------------------------------
--  DESCARTABLES por orden "para llevar" (bandeja + cuchara + …)
--   Al vender 'llevar' se descuentan estos del inventario.
-- ----------------------------------------------------------------------------
create table takeout_packaging (
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id),
  qty_per_order numeric(12,4) not null default 1,
  primary key (restaurant_id, ingredient_id)
);

-- ----------------------------------------------------------------------------
--  TANDAS DE PRODUCCIÓN
--   contable -> units_produced + unit_cost (= total/units)
--   granel   -> units_produced NULL; el total_cost suma al pool del día
-- ----------------------------------------------------------------------------
create table production_batches (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references restaurants(id) on delete cascade,
  ingredient_id    uuid not null references ingredients(id),
  shift_session_id uuid references shift_sessions(id),
  business_date    date not null default current_date,
  user_id          uuid references users(id),
  total_cost       numeric(12,2) not null default 0,
  units_produced   numeric(12,4),               -- null = granel
  unit_cost        numeric(12,4) generated always as (
                     case when units_produced is null or units_produced = 0
                          then null
                          else round(total_cost / units_produced, 4) end
                   ) stored,
  note             text,
  created_at       timestamptz not null default now()
);
create index idx_batches_restaurant on production_batches(restaurant_id, business_date);
create index idx_batches_ingredient on production_batches(ingredient_id, business_date);

-- ----------------------------------------------------------------------------
--  MOVIMIENTOS DE INVENTARIO (solo CONTABLES; qty con signo: +entra / -sale)
--   stock = sum(qty). Granel no lleva stock por unidades (lleva pool de costo).
-- ----------------------------------------------------------------------------
create table inventory_movements (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references restaurants(id) on delete cascade,
  ingredient_id    uuid not null references ingredients(id),
  shift_session_id uuid references shift_sessions(id),
  business_date    date not null default current_date,
  type             text not null check (type in
                     ('compra','produccion','venta','retiro','merma','ajuste')),
  qty              numeric(12,4) not null,       -- + entradas, - salidas
  unit_cost        numeric(12,4) not null default 0,
  total_cost       numeric(12,2) generated always as (round(qty * unit_cost, 2)) stored,
  reason           text,                          -- obligatorio en 'retiro' (app)
  user_id          uuid references users(id),
  ref_table        text,                          -- 'sales','production_batches'…
  ref_id           uuid,
  created_at       timestamptz not null default now()
);
create index idx_invmov_ingredient on inventory_movements(ingredient_id, business_date);
create index idx_invmov_restaurant on inventory_movements(restaurant_id, business_date);

-- ============================================================================
--  CIERRE DIARIO (costos) — distinto del cierre de turno (caja)
-- ============================================================================
create table daily_close (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  business_date date not null,
  status        text not null default 'open' check (status in ('open','closed')),
  closed_by     uuid references users(id),
  closed_at     timestamptz,
  notes         text,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, business_date)
);

-- Prorrateo + merma del GRANEL por día (resultado del cierre)
create table granel_close (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references restaurants(id) on delete cascade,
  business_date      date not null,
  ingredient_id      uuid not null references ingredients(id),
  pool_cost          numeric(12,2) not null default 0,   -- costo total consumido ese día
  plates_count       int not null default 0,             -- platos vendidos que lo usan
  merma_pct          numeric(5,2) not null default 0,    -- % declarado que se botó
  merma_cost         numeric(12,2) generated always as (
                       round(pool_cost * merma_pct / 100, 2)) stored,
  distributable_cost numeric(12,2) generated always as (
                       round(pool_cost * (1 - merma_pct / 100), 2)) stored,
  cost_per_plate     numeric(12,4) generated always as (
                       case when plates_count > 0
                            then round(pool_cost * (1 - merma_pct / 100) / plates_count, 4)
                            else null end) stored,
  created_at         timestamptz not null default now(),
  unique (restaurant_id, business_date, ingredient_id)
);

-- Conteo físico de CONTABLES al cierre (esperado vs contado -> merma/faltante/robo)
create table inventory_counts (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  business_date date not null,
  ingredient_id uuid not null references ingredients(id),
  expected_qty  numeric(12,4) not null default 0,
  counted_qty   numeric(12,4) not null default 0,
  diff          numeric(12,4) generated always as (counted_qty - expected_qty) stored,
  tag           text check (tag in ('merma','error','faltante')),  -- clasificación
  created_at    timestamptz not null default now(),
  unique (restaurant_id, business_date, ingredient_id)
);

-- ----------------------------------------------------------------------------
--  VISTAS de apoyo
-- ----------------------------------------------------------------------------
-- Stock actual de contables (sum de movimientos)
create or replace view v_stock_contable
  with (security_invoker = on) as
select i.restaurant_id, i.id as ingredient_id, i.name,
       coalesce(sum(m.qty), 0) as stock
from ingredients i
left join inventory_movements m on m.ingredient_id = i.id
where i.kind = 'contable'
group by i.restaurant_id, i.id, i.name;

-- Pool de granel por día (suma de tandas granel)
create or replace view v_pool_granel
  with (security_invoker = on) as
select pb.restaurant_id, pb.business_date, pb.ingredient_id,
       i.name, sum(pb.total_cost) as pool_cost
from production_batches pb
join ingredients i on i.id = pb.ingredient_id and i.kind = 'granel'
group by pb.restaurant_id, pb.business_date, pb.ingredient_id, i.name;

-- ============================================================================
--  CERRAR DÍA: calcula el pool y los platos por insumo granel, aplica la merma
--  declarada y guarda el prorrateo. p_merma = { "<ingredient_id>": <pct>, ... }
-- ============================================================================
create or replace function cerrar_dia(
  p_restaurant uuid,
  p_date       date,
  p_merma      jsonb default '{}'::jsonb,
  p_closed_by  uuid default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  r          record;
  v_plates   int;
  v_merma    numeric(5,2);
  v_result   jsonb := '[]'::jsonb;
begin
  -- por cada insumo granel con tandas ese día
  for r in
    select pool.ingredient_id, pool.name, pool.pool_cost
    from v_pool_granel pool
    where pool.restaurant_id = p_restaurant and pool.business_date = p_date
  loop
    -- platos vendidos ese día que incluyen este insumo granel
    select coalesce(sum(s.qty), 0) into v_plates
    from sales s
    join dish_components dc on dc.dish_id = s.dish_id
    where s.restaurant_id = p_restaurant
      and s.business_date = p_date
      and dc.ingredient_id = r.ingredient_id;

    v_merma := coalesce((p_merma ->> r.ingredient_id::text)::numeric, 0);

    insert into granel_close (restaurant_id, business_date, ingredient_id,
                              pool_cost, plates_count, merma_pct)
    values (p_restaurant, p_date, r.ingredient_id, r.pool_cost, v_plates, v_merma)
    on conflict (restaurant_id, business_date, ingredient_id)
    do update set pool_cost = excluded.pool_cost,
                  plates_count = excluded.plates_count,
                  merma_pct = excluded.merma_pct;

    v_result := v_result || jsonb_build_object(
      'ingredient', r.name, 'pool_cost', r.pool_cost,
      'plates', v_plates, 'merma_pct', v_merma);
  end loop;

  -- marcar el día como cerrado
  insert into daily_close (restaurant_id, business_date, status, closed_by, closed_at)
  values (p_restaurant, p_date, 'closed', p_closed_by, now())
  on conflict (restaurant_id, business_date)
  do update set status = 'closed', closed_by = p_closed_by, closed_at = now();

  insert into audit_log(restaurant_id, user_id, action, entity, payload)
  values (p_restaurant, p_closed_by, 'cerrar_dia', 'daily_close',
          jsonb_build_object('date', p_date, 'granel', v_result));

  return jsonb_build_object('business_date', p_date, 'granel', v_result);
end;
$$;

-- ============================================================================
--  RLS (mismo patrón: scoped por restaurant_id)
-- ============================================================================
alter table ingredients        enable row level security;
alter table dish_components     enable row level security;
alter table takeout_packaging   enable row level security;
alter table production_batches  enable row level security;
alter table inventory_movements enable row level security;
alter table daily_close         enable row level security;
alter table granel_close        enable row level security;
alter table inventory_counts    enable row level security;

create policy ingredients_all on ingredients for all
  using (restaurant_id = app.restaurant_id())
  with check (restaurant_id = app.restaurant_id());
create policy dishcomp_all on dish_components for all
  using (restaurant_id = app.restaurant_id())
  with check (restaurant_id = app.restaurant_id());
create policy packaging_all on takeout_packaging for all
  using (restaurant_id = app.restaurant_id())
  with check (restaurant_id = app.restaurant_id());
create policy batches_all on production_batches for all
  using (restaurant_id = app.restaurant_id())
  with check (restaurant_id = app.restaurant_id());
create policy invmov_all on inventory_movements for all
  using (restaurant_id = app.restaurant_id())
  with check (restaurant_id = app.restaurant_id());
create policy dailyclose_all on daily_close for all
  using (restaurant_id = app.restaurant_id())
  with check (restaurant_id = app.restaurant_id());
create policy granelclose_all on granel_close for all
  using (restaurant_id = app.restaurant_id())
  with check (restaurant_id = app.restaurant_id());
create policy invcounts_all on inventory_counts for all
  using (restaurant_id = app.restaurant_id())
  with check (restaurant_id = app.restaurant_id());

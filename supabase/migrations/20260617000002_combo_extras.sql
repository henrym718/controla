-- ============================================================================
--  CONTROLA · Migración · EXTRAS PROPIOS DEL COMBO (insumo suelto del inventario)
--
--  Pedido (jun-2026, dueña): además de heredar la receta de sus platos, un combo
--  debe poder llevar un INSUMO extra propio del inventario (ej. una cola, un vaso)
--  que se descuente SOLO cuando se vende ese combo, sin que ese insumo sea un
--  plato ni un adicional vendible aparte.
--
--  Diseño (seguro para producción, 100% aditivo):
--   · Tabla nueva combo_extras(combo_dish_id, ingredient_id, qty): los insumos que
--     el admin agrega directo a un combo.
--   · La receta EFECTIVA de un combo pasa a ser:
--        recetas de sus partes (en vivo)  +  sus combo_extras.
--   · Se REDEFINE recetas_efectivas() (misma firma) para sumar los extras. La
--     "foto" que algún combo viejo tenga en sus propios dish_components SIGUE
--     ignorándose (la rama de receta propia excluye combos), así NO hay doble
--     conteo y NO hace falta limpiar datos existentes.
-- ============================================================================

-- ----------------------------------------------------------------------------
--  Tabla: insumos extra propios del combo.
-- ----------------------------------------------------------------------------
create table if not exists combo_extras (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  combo_dish_id uuid not null references dishes(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id),
  qty           numeric(12,4) not null default 1,
  created_at    timestamptz not null default now(),
  unique (combo_dish_id, ingredient_id)
);
create index if not exists idx_combo_extras_combo on combo_extras(combo_dish_id);

alter table combo_extras enable row level security;
create policy combo_extras_all on combo_extras for all
  using (restaurant_id = app.restaurant_id())
  with check (restaurant_id = app.restaurant_id());

-- ----------------------------------------------------------------------------
--  recetas_efectivas(p_dish) -> (ingredient_id, qty)
--   combo -> recetas vivas de sus partes  +  sus extras propios.
--   plato -> su propia receta.
--   Las ramas no se solapan: la "foto" propia de un combo (dish_components con
--   is_combo=true) queda fuera, por eso no se cuenta doble.
-- ----------------------------------------------------------------------------
create or replace function recetas_efectivas(p_dish uuid)
returns table (ingredient_id uuid, qty numeric)
  language sql
  stable
  set search_path = public, app
as $$
  select e.ingredient_id, sum(e.qty)::numeric as qty
  from (
    -- combo: recetas vivas de las partes (platos/adicionales que lo forman)
    select dc.ingredient_id, dc.qty
    from combo_parts cp
    join dish_components dc on dc.dish_id = cp.part_dish_id
    where cp.combo_dish_id = p_dish

    union all

    -- combo: extras propios (insumos del inventario añadidos directo al combo)
    select ce.ingredient_id, ce.qty
    from combo_extras ce
    where ce.combo_dish_id = p_dish

    union all

    -- plato normal: su propia receta (los combos quedan excluidos)
    select dc.ingredient_id, dc.qty
    from dish_components dc
    join dishes d on d.id = dc.dish_id
    where dc.dish_id = p_dish and d.is_combo = false
  ) e
  group by e.ingredient_id;
$$;

revoke all on function recetas_efectivas(uuid) from public;
grant execute on function recetas_efectivas(uuid) to service_role;

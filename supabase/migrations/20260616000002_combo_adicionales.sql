-- ============================================================================
--  CONTROLA · Migración · COMBOS CON ADICIONALES
--
--  Pedido del usuario (jun-2026): en el catálogo, un combo podía armarse solo
--  con platos (sopa + segundo). Ahora un combo puede incluir también
--  ADICIONALES (huevo extra, vaso de cola, porción…) y, en general, cualquier
--  mezcla de ítems del catálogo.
--
--  Es ADITIVO y seguro para producción:
--   (1) Ensancha el CHECK de combo_parts.role para permitir 'adicional'
--       (sin tocar las filas existentes; solo amplía los valores válidos).
--   (2) Agrega una RPC NUEVA `armar_combo` que recibe una lista de partes
--       [{dish_id, role}] y arma el combo (dish + combo_parts + receta sumada).
--
--  NO se modifica el RPC `crear_combo` (lo usa la IA de voz y el flujo viejo):
--  queda intacto para combos sopa + segundo.
-- ============================================================================

-- ----------------------------------------------------------------------------
--  (1) Permitir el rol 'adicional' en combo_parts. Quita el CHECK viejo del
--      campo role sea cual sea su nombre autogenerado, y agrega el ampliado.
-- ----------------------------------------------------------------------------
do $$
declare
  v_con text;
begin
  select conname into v_con
  from pg_constraint
  where conrelid = 'public.combo_parts'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%role%';
  if v_con is not null then
    execute format('alter table public.combo_parts drop constraint %I', v_con);
  end if;
end $$;

alter table public.combo_parts
  add constraint combo_parts_role_check
  check (role in ('sopa', 'segundo', 'adicional'));

-- ----------------------------------------------------------------------------
--  (2) RPC NUEVA · armar_combo — combo flexible de N partes (platos y/o
--      adicionales). p_parts = [{"dish_id":"...","role":"sopa|segundo|adicional"}].
--      Arma el plato-combo (is_combo), guarda sus partes y su receta = suma de
--      las recetas de todas las partes. Mismo patrón/seguridad que crear_combo.
-- ----------------------------------------------------------------------------
create or replace function armar_combo(
  p_restaurant uuid,
  p_parts      jsonb,
  p_name       text default null,
  p_price      numeric default null,
  p_user       uuid default null
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_ids   uuid[];
  v_n     int;
  v_label text;
  v_name  text;
  v_combo uuid;
begin
  -- ids únicos y no vacíos de las partes
  select array_agg(distinct (e->>'dish_id')::uuid)
    into v_ids
  from jsonb_array_elements(coalesce(p_parts, '[]'::jsonb)) e
  where coalesce(e->>'dish_id', '') <> '';

  if v_ids is null or array_length(v_ids, 1) < 2 then
    raise exception 'Un combo necesita al menos 2 ítems del catálogo';
  end if;

  -- todas las partes deben existir en este restaurante
  select count(*) into v_n
  from dishes d
  where d.id = any(v_ids) and d.restaurant_id = p_restaurant;
  if v_n <> array_length(v_ids, 1) then
    raise exception 'Alguna parte del combo no existe en este restaurante';
  end if;

  -- nombre por defecto: "Combo <segundo>" (o el primer ítem si no hay segundo)
  select d.name into v_label
  from jsonb_array_elements(p_parts) e
  join dishes d on d.id = (e->>'dish_id')::uuid
  where coalesce(e->>'role', 'segundo') = 'segundo'
  order by d.name
  limit 1;
  if v_label is null then
    select name into v_label from dishes where id = v_ids[1];
  end if;
  v_name := coalesce(nullif(btrim(p_name), ''), 'Combo ' || coalesce(v_label, ''));

  -- upsert del plato-combo
  insert into dishes (restaurant_id, name, price, is_combo)
  values (p_restaurant, v_name, coalesce(p_price, 0), true)
  on conflict (restaurant_id, name)
  do update set is_combo = true,
                active   = true,
                price    = coalesce(p_price, dishes.price)
  returning id into v_combo;

  -- partes del combo (una fila por dish; rol válido o 'segundo' por defecto)
  delete from combo_parts where combo_dish_id = v_combo;
  insert into combo_parts (restaurant_id, combo_dish_id, part_dish_id, role)
  select p_restaurant, v_combo, q.dish_id, q.role
  from (
    select distinct on ((e->>'dish_id')::uuid)
           (e->>'dish_id')::uuid as dish_id,
           case when coalesce(e->>'role', 'segundo') in ('sopa', 'segundo', 'adicional')
                then coalesce(e->>'role', 'segundo') else 'segundo' end as role
    from jsonb_array_elements(p_parts) e
    where coalesce(e->>'dish_id', '') <> ''
  ) q;

  -- receta del combo = suma de las recetas de todas las partes
  delete from dish_components where dish_id = v_combo;
  insert into dish_components (restaurant_id, dish_id, ingredient_id, qty)
  select p_restaurant, v_combo, dc.ingredient_id, sum(dc.qty)
  from dish_components dc
  where dc.dish_id = any(v_ids)
  group by dc.ingredient_id;

  insert into audit_log (restaurant_id, user_id, action, entity, entity_id, payload)
  values (p_restaurant, p_user, 'crear_combo', 'dishes', v_combo,
          jsonb_build_object('name', v_name, 'parts', p_parts, 'price', p_price));

  return jsonb_build_object('combo_dish_id', v_combo, 'name', v_name);
end;
$$;

revoke execute on function armar_combo(uuid, jsonb, text, numeric, uuid) from public;
grant  execute on function armar_combo(uuid, jsonb, text, numeric, uuid) to service_role;

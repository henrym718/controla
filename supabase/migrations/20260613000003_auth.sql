-- ============================================================================
--  CONTROLA · Migración 0003 · AUTH RPC
--  Valida el PIN dentro de la base (bcrypt vía pgcrypto). El servidor la llama
--  con service_role; se revoca a anon/authenticated para evitar fuerza bruta.
-- ============================================================================

create or replace function login_pin(p_restaurant uuid, p_pin text)
returns table (id uuid, name text, role text)
  language sql
  stable
  security definer
  set search_path = public, app, extensions
as $$
  select u.id, u.name, u.role
  from users u
  where u.restaurant_id = p_restaurant
    and u.active
    and u.pin_hash = crypt(p_pin, u.pin_hash)
  limit 1;
$$;

-- Endurecer permisos de las funciones expuestas por REST
revoke execute on function login_pin(uuid, text)            from public;
revoke execute on function cerrar_turno(uuid, numeric, uuid) from public;
revoke execute on function cerrar_dia(uuid, date, jsonb, uuid) from public;

grant execute on function login_pin(uuid, text)            to service_role;
grant execute on function cerrar_turno(uuid, numeric, uuid) to service_role;
grant execute on function cerrar_dia(uuid, date, jsonb, uuid) to service_role;

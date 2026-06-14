-- ============================================================================
--  CONTROLA · Migración 0010 · PLATAFORMA (super-admin) + BLOQUEO DE LOGIN
--
--  - auth_throttle + RPCs: bloqueo del lado del SERVIDOR (no localStorage, que se
--    salta fácil). Tras N intentos fallidos desde una "llave" (ip+restaurante o
--    ip+super) se bloquea por X minutos. Es la protección real para los PIN.
--  - crear_restaurante: el dueño de la plataforma da de alta un restaurante con su
--    turno por defecto y su usuaria admin (PIN hasheado). Listo para compartir la URL.
-- ============================================================================

-- ----------------------------------------------------------------------------
--  Throttle de autenticación (anti fuerza bruta del PIN)
-- ----------------------------------------------------------------------------
create table if not exists auth_throttle (
  id            text primary key,          -- 'super:<ip>' | '<slug>:<ip>'
  fails         int not null default 0,
  blocked_until timestamptz,
  updated_at    timestamptz not null default now()
);
alter table auth_throttle enable row level security;  -- sin policy: solo service_role

-- ¿La llave está bloqueada ahora? devuelve hasta cuándo (o null).
create or replace function auth_estado(p_key text)
returns timestamptz
  language sql
  stable
  security definer
  set search_path = public, app
as $$
  select blocked_until
  from auth_throttle
  where id = p_key and blocked_until is not null and blocked_until > now();
$$;

-- Registra un intento. Éxito → limpia. Fallo → suma; al llegar al máximo bloquea.
create or replace function auth_intento(
  p_key       text,
  p_ok        boolean,
  p_max       int default 5,
  p_block_min int default 15
) returns timestamptz
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_fails int;
  v_until timestamptz;
begin
  if p_ok then
    delete from auth_throttle where id = p_key;
    return null;
  end if;

  insert into auth_throttle (id, fails, updated_at)
  values (p_key, 1, now())
  on conflict (id) do update
    set fails = auth_throttle.fails + 1, updated_at = now()
  returning fails into v_fails;

  if v_fails >= p_max then
    v_until := now() + make_interval(mins => p_block_min);
    update auth_throttle set blocked_until = v_until, fails = 0 where id = p_key;
    return v_until;
  end if;
  return null;
end;
$$;

-- ----------------------------------------------------------------------------
--  Alta de un restaurante completo (restaurante + turno por defecto + admin)
-- ----------------------------------------------------------------------------
create or replace function crear_restaurante(
  p_slug       text,
  p_name       text,
  p_admin_name text,
  p_admin_pin  text
) returns jsonb
  language plpgsql
  security definer
  set search_path = public, app, extensions
as $$
declare
  v_rest  uuid;
  v_user  uuid;
begin
  if p_slug !~ '^[a-z0-9-]{2,40}$' then
    raise exception 'El enlace solo admite minúsculas, números y guiones (2–40)';
  end if;
  if exists (select 1 from restaurants where slug = p_slug) then
    raise exception 'Ese enlace (slug) ya está en uso';
  end if;
  if length(coalesce(p_admin_pin, '')) < 4 then
    raise exception 'El PIN debe tener al menos 4 dígitos';
  end if;

  insert into restaurants (slug, name) values (p_slug, p_name) returning id into v_rest;

  -- turno por defecto (todo el día) para que la admin pueda entrar de una
  insert into shifts (restaurant_id, name, start_time, end_time, sort_order)
  values (v_rest, 'Todo el día', '00:00', '23:59', 0);

  -- usuaria admin con PIN hasheado
  insert into users (restaurant_id, name, role, pin_hash)
  values (v_rest, p_admin_name, 'admin', crypt(p_admin_pin, gen_salt('bf')))
  returning id into v_user;

  return jsonb_build_object('restaurant_id', v_rest, 'slug', p_slug, 'admin_id', v_user);
end;
$$;

-- ----------------------------------------------------------------------------
--  Permisos: solo el servidor (service_role).
-- ----------------------------------------------------------------------------
revoke execute on function auth_estado(text)                        from public;
revoke execute on function auth_intento(text, boolean, int, int)    from public;
revoke execute on function crear_restaurante(text, text, text, text) from public;

grant execute on function auth_estado(text)                        to service_role;
grant execute on function auth_intento(text, boolean, int, int)    to service_role;
grant execute on function crear_restaurante(text, text, text, text) to service_role;

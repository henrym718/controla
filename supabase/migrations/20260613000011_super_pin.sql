-- ============================================================================
--  CONTROLA · Migración 0011 · PIN DEL PANEL (super-admin) EN LA BASE
--   El PIN para entrar a /panel se guarda HASHEADO en la base (igual que los PIN
--   de los usuarios), no en variables de entorno. El pipeline de despliegue lo
--   "registra" llamando a set_super_pin con el secreto de GitHub. La app lo valida
--   con verify_super_pin. (En local hay un fallback por env: ver superLoginAction.)
-- ============================================================================

create table if not exists platform_config (
  id             int primary key default 1 check (id = 1),  -- fila única
  super_pin_hash text,
  updated_at     timestamptz not null default now()
);
alter table platform_config enable row level security;  -- sin policy: solo service_role

-- Registrar / cambiar el PIN del panel (lo llama el pipeline por psql).
create or replace function set_super_pin(p_pin text)
returns void
  language plpgsql
  security definer
  set search_path = public, extensions
as $$
begin
  if length(coalesce(p_pin, '')) < 4 then
    raise exception 'El PIN debe tener al menos 4 dígitos';
  end if;
  insert into platform_config (id, super_pin_hash, updated_at)
  values (1, crypt(p_pin, gen_salt('bf')), now())
  on conflict (id) do update
    set super_pin_hash = excluded.super_pin_hash, updated_at = now();
end;
$$;

-- Validar el PIN del panel (lo llama la app en superLoginAction).
create or replace function verify_super_pin(p_pin text)
returns boolean
  language sql
  stable
  security definer
  set search_path = public, extensions
as $$
  select exists (
    select 1 from platform_config
    where id = 1
      and super_pin_hash is not null
      and super_pin_hash = crypt(p_pin, super_pin_hash)
  );
$$;

revoke execute on function set_super_pin(text)    from public;
revoke execute on function verify_super_pin(text) from public;
grant  execute on function set_super_pin(text)    to service_role;
grant  execute on function verify_super_pin(text) to service_role;

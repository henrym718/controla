-- ============================================================================
--  CONTROLA · Migración 0004 · GESTIÓN DE USUARIOS + HORARIOS
--  Cada PIN = un usuario. El admin puede crear/editar PINs, rol y horario.
--  El admin no tiene horario (entra siempre); el empleado usa su horario
--  (el del turno asignado o uno específico).
-- ============================================================================

alter table users add column if not exists default_shift_id uuid references shifts(id);
alter table users add column if not exists schedule_start time;
alter table users add column if not exists schedule_end time;

-- Crear usuario con PIN (hash en la base). Valida PIN único por restaurante.
create or replace function admin_create_user(
  p_restaurant uuid,
  p_name       text,
  p_role       text,
  p_pin        text,
  p_shift_id   uuid default null,
  p_start      time default null,
  p_end        time default null
) returns uuid
  language plpgsql
  security definer
  set search_path = public, app, extensions
as $$
declare
  v_id uuid;
begin
  if exists (
    select 1 from users
    where restaurant_id = p_restaurant and active
      and pin_hash = crypt(p_pin, pin_hash)
  ) then
    raise exception 'Ese PIN ya está en uso';
  end if;

  insert into users (restaurant_id, name, role, pin_hash,
                     default_shift_id, schedule_start, schedule_end)
  values (p_restaurant, p_name,
          case when p_role = 'admin' then 'admin' else 'empleado' end,
          crypt(p_pin, gen_salt('bf')),
          p_shift_id, p_start, p_end)
  returning id into v_id;
  return v_id;
end;
$$;

-- Cambiar el PIN de un usuario (valida unicidad excluyéndose a sí mismo).
create or replace function admin_set_pin(p_user uuid, p_pin text)
  returns void
  language plpgsql
  security definer
  set search_path = public, app, extensions
as $$
declare
  v_restaurant uuid;
begin
  select restaurant_id into v_restaurant from users where id = p_user;
  if exists (
    select 1 from users
    where restaurant_id = v_restaurant and active and id <> p_user
      and pin_hash = crypt(p_pin, pin_hash)
  ) then
    raise exception 'Ese PIN ya está en uso';
  end if;
  update users set pin_hash = crypt(p_pin, gen_salt('bf')) where id = p_user;
end;
$$;

revoke execute on function admin_create_user(uuid, text, text, text, uuid, time, time) from public;
revoke execute on function admin_set_pin(uuid, text) from public;
grant execute on function admin_create_user(uuid, text, text, text, uuid, time, time) to service_role;
grant execute on function admin_set_pin(uuid, text) to service_role;

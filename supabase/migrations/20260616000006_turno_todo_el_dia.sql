-- ============================================================================
--  CONTROLA · Migración 0006(16-jun) · TURNO "TODO EL DÍA" GARANTIZADO
--   El turno "Todo el día" SIEMPRE existe en cada restaurante, no se puede
--   borrar ni desactivar, y el menú que se ponga ahí se HEREDA a todos los
--   turnos de ese día (la herencia se resuelve en la app: turno propio ∪
--   todo-el-día). Aquí solo lo identificamos con un flag y garantizamos que
--   exista uno por restaurante.
--
--   Aditiva. No toca RPCs vivas (regla de producción): crear_restaurante sigue
--   insertando "Todo el día" tal cual; un trigger lo marca solo.
-- ============================================================================

alter table shifts
  add column if not exists is_all_day boolean not null default false;

-- 1) Marcar (y reactivar) los turnos "Todo el día" que ya existen.
update shifts
   set is_all_day = true, active = true
 where lower(btrim(name)) = 'todo el día'
   and (is_all_day = false or active = false);

-- 2) Garantizar que CADA restaurante tenga su turno todo-el-día.
insert into shifts (restaurant_id, name, start_time, end_time, sort_order, is_all_day)
select r.id, 'Todo el día', '00:00', '23:59', 0, true
  from restaurants r
 where not exists (
   select 1 from shifts s
    where s.restaurant_id = r.id and s.is_all_day
 )
on conflict (restaurant_id, name)
  do update set is_all_day = true, active = true;

-- 3) A lo sumo UN turno todo-el-día por restaurante.
create unique index if not exists uq_shifts_all_day
  on shifts(restaurant_id) where is_all_day;

-- 4) Los turnos nuevos llamados "Todo el día" (los que crea crear_restaurante)
--    se marcan solos, sin modificar esa RPC en producción.
create or replace function app.mark_all_day_shift()
returns trigger language plpgsql as $$
begin
  if not coalesce(new.is_all_day, false)
     and lower(btrim(new.name)) = 'todo el día' then
    new.is_all_day := true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_shifts_mark_all_day on shifts;
create trigger trg_shifts_mark_all_day
  before insert on shifts
  for each row execute function app.mark_all_day_shift();

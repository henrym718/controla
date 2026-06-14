-- ============================================================================
--  CONTROLA · Migración 0008 · CIERRE DE CAJA ENRIQUECIDO (cuadre por turno)
--   La encargada, al cerrar su turno:
--     1. cuenta físicamente la caja              → counted_cash
--     2. deja una base para el próximo turno      → closing_float (editable; por
--        defecto la apertura. Puede dejar más o menos.)
--     3. entrega el resto a la jefa               → deposit_amount = contado − base
--   El descuadre (anti-robo) sigue siendo contado − esperado (lo que dice el
--   sistema). La base/entrega es solo logística de efectivo; no cambia el descuadre.
--
--   RPCs (atómicas, rápidas — sin server actions para las lecturas calientes):
--     - resumen_turno(session)      → resumen en vivo para el modal de cierre.
--     - cerrar_turno(...)           → reemplaza la versión 0001 con base + entrega.
--     - cuadres_dia(restaurant, dia)→ histórico de cuadres por turno (la jefa).
-- ============================================================================

-- ----------------------------------------------------------------------------
--  Columnas nuevas en la sesión de turno
-- ----------------------------------------------------------------------------
alter table shift_sessions
  add column if not exists closing_float  numeric(12,2),  -- base que se deja en caja
  add column if not exists deposit_amount numeric(12,2);  -- efectivo entregado a la jefa

comment on column shift_sessions.closing_float  is 'Efectivo que la encargada deja en caja para el próximo turno (base). Por defecto = opening_cash.';
comment on column shift_sessions.deposit_amount is 'Efectivo entregado a la jefa = counted_cash − closing_float.';

-- ============================================================================
--  RPC · resumen_turno — foto en vivo de la sesión para el modal de cierre
--   ventas (por método), gastos (consumibles/servicios), egresos de caja
--   (compras/retiros), aportes, y la caja (apertura + esperada).
-- ============================================================================
create or replace function resumen_turno(p_session_id uuid)
returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_ss       shift_sessions;
  v_esperada numeric(12,2);
  v_shift    text;
  v_resp     text;
  v_ventas   jsonb;
  v_gastos   jsonb;
  v_egresos  jsonb;
  v_aportes  numeric(12,2);
begin
  select * into v_ss from shift_sessions where id = p_session_id;
  if v_ss.id is null then
    raise exception 'Sesión % no encontrada', p_session_id;
  end if;

  select caja_esperada into v_esperada from v_caja_turno where shift_session_id = p_session_id;
  select name into v_shift from shifts where id = v_ss.shift_id;
  select name into v_resp  from users  where id = v_ss.responsible_user_id;

  -- ventas por método de pago
  select jsonb_build_object(
    'total',         coalesce(sum(total), 0),
    'efectivo',      coalesce(sum(total) filter (where payment_method = 'efectivo'), 0),
    'transferencia', coalesce(sum(total) filter (where payment_method = 'transferencia'), 0),
    'otro',          coalesce(sum(total) filter (where payment_method = 'otro'), 0),
    'n',             count(*)
  ) into v_ventas
  from sales where shift_session_id = p_session_id;

  -- gastos del turno (servilletas, jabón, aceite, servicios… = costo del día)
  select jsonb_build_object(
    'total', coalesce(sum(amount), 0),
    'items', coalesce(
      jsonb_agg(
        jsonb_build_object('name', coalesce(nullif(btrim(note), ''), category), 'amount', amount)
        order by amount desc
      ), '[]'::jsonb)
  ) into v_gastos
  from expenses where shift_session_id = p_session_id;

  -- egresos de caja: compras de inventario y retiros (debitan caja)
  select jsonb_build_object(
    'total', coalesce(sum(amount) filter (where type = 'egreso'), 0),
    'items', coalesce(
      jsonb_agg(
        jsonb_build_object('reason', reason, 'amount', amount)
        order by amount desc
      ) filter (where type = 'egreso'), '[]'::jsonb)
  ) into v_egresos
  from cash_movements where shift_session_id = p_session_id;

  select coalesce(sum(amount), 0) into v_aportes
  from cash_movements where shift_session_id = p_session_id and type = 'ingreso';

  return jsonb_build_object(
    'session_id',  v_ss.id,
    'shift',       v_shift,
    'responsable', v_resp,
    'ventas',      v_ventas,
    'gastos',      v_gastos,
    'egresos',     v_egresos,
    'aportes',     v_aportes,
    'caja', jsonb_build_object(
      'apertura', v_ss.opening_cash,
      'esperada', coalesce(v_esperada, v_ss.opening_cash)
    )
  );
end;
$$;

-- ============================================================================
--  RPC · cerrar_turno (REEMPLAZA la de 0001 con base que se deja + entrega)
--   Calcula esperado, guarda contado, base (closing_float) y entrega
--   (deposit_amount = contado − base), y el descuadre (contado − esperado).
--   Marca la sesión cerrada → la app saca a TODAS las miembros (re-login).
-- ============================================================================
drop function if exists cerrar_turno(uuid, numeric, uuid);

create or replace function cerrar_turno(
  p_session_id    uuid,
  p_counted_cash  numeric,
  p_closing_float numeric,
  p_closed_by     uuid,
  p_notes         text default null
) returns shift_sessions
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_expected numeric(12,2);
  v_float    numeric(12,2);
  v_row      shift_sessions;
begin
  select caja_esperada into v_expected
    from v_caja_turno where shift_session_id = p_session_id;

  update shift_sessions ss
     set status           = 'closed',
         expected_cash    = coalesce(v_expected, ss.opening_cash),
         counted_cash     = p_counted_cash,
         closing_float    = coalesce(p_closing_float, ss.opening_cash),
         deposit_amount   = p_counted_cash - coalesce(p_closing_float, ss.opening_cash),
         cash_discrepancy = p_counted_cash - coalesce(v_expected, ss.opening_cash),
         notes            = coalesce(nullif(btrim(p_notes), ''), ss.notes),
         closed_by        = p_closed_by,
         closed_at        = now()
   where ss.id = p_session_id
     and ss.status = 'open'
   returning ss.* into v_row;

  if v_row.id is null then
    raise exception 'La sesión % no existe o ya está cerrada', p_session_id;
  end if;

  insert into audit_log(restaurant_id, user_id, shift_session_id, action, entity, entity_id, payload)
  values (v_row.restaurant_id, p_closed_by, v_row.id, 'cerrar_turno', 'shift_session', v_row.id,
          jsonb_build_object('expected', v_row.expected_cash,
                             'counted', v_row.counted_cash,
                             'discrepancy', v_row.cash_discrepancy,
                             'closing_float', v_row.closing_float,
                             'deposit', v_row.deposit_amount));
  return v_row;
end;
$$;

-- ============================================================================
--  RPC · cuadres_dia — histórico de cuadres por turno para un día (la jefa)
--   Un objeto por turno-sesión del día: estado, responsable, quién cerró, caja
--   (apertura/esperada/contada/descuadre), base dejada, entrega, ventas y costos.
--   Si el turno sigue abierto, la "esperada" sale en vivo de v_caja_turno.
-- ============================================================================
create or replace function cuadres_dia(p_restaurant uuid, p_date date)
returns jsonb
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_turnos jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(t) order by t.sort_order nulls last, t.opened_at), '[]'::jsonb)
  into v_turnos
  from (
    select
      ss.id,
      sh.name       as shift,
      sh.sort_order,
      ss.opened_at,
      ss.closed_at,
      ss.status,
      ru.name       as responsable,
      cu.name       as cerro_por,
      ss.opening_cash,
      case when ss.status = 'closed' then ss.expected_cash
           else (select caja_esperada from v_caja_turno where shift_session_id = ss.id)
      end           as esperada,
      ss.counted_cash,
      ss.cash_discrepancy,
      ss.closing_float,
      ss.deposit_amount,
      (select coalesce(sum(s.total), 0) from sales s where s.shift_session_id = ss.id) as ventas,
      (select coalesce(sum(s.total), 0) from sales s where s.shift_session_id = ss.id and s.payment_method = 'efectivo') as ventas_efectivo,
      (select coalesce(sum(e.amount), 0) from expenses e where e.shift_session_id = ss.id) as gastos,
      (select coalesce(sum(c.amount), 0) from cash_movements c where c.shift_session_id = ss.id and c.type = 'egreso') as egresos,
      (select coalesce(sum(c.amount), 0) from cash_movements c where c.shift_session_id = ss.id and c.type = 'ingreso') as aportes
    from shift_sessions ss
    join shifts sh on sh.id = ss.shift_id
    left join users ru on ru.id = ss.responsible_user_id
    left join users cu on cu.id = ss.closed_by
    where ss.restaurant_id = p_restaurant
      and ss.business_date = p_date
  ) t;

  return jsonb_build_object('date', p_date, 'turnos', v_turnos);
end;
$$;

-- ----------------------------------------------------------------------------
--  Permisos: solo el servidor (service_role); revocadas a anon/authenticated.
-- ----------------------------------------------------------------------------
revoke execute on function resumen_turno(uuid)                          from public;
revoke execute on function cerrar_turno(uuid, numeric, numeric, uuid, text) from public;
revoke execute on function cuadres_dia(uuid, date)                      from public;

grant execute on function resumen_turno(uuid)                          to service_role;
grant execute on function cerrar_turno(uuid, numeric, numeric, uuid, text) to service_role;
grant execute on function cuadres_dia(uuid, date)                      to service_role;

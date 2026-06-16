-- ============================================================================
--  CONTROLA · Migración 0007(16-jun) · CONTEO DE CAJA BLOQUEADO (anti-robo)
--
--  El cierre del turno ahora arranca pidiendo PRIMERO el efectivo contado
--  (TODO lo que hay físicamente en la caja, incluida la base con la que se
--  abrió) ANTES de mostrar lo esperado. Una vez registrado queda BLOQUEADO:
--  la encargada NO puede cambiarlo (no puede "bajar" el número al ver que
--  sobra para quedarse el excedente). Solo la jefa (admin) puede reabrirlo si
--  hubo un error de digitación.
--
--  Aditiva y segura para producción:
--    - Agrega una columna (counted_at). No toca datos existentes.
--    - registrar_conteo_caja / reabrir_conteo_caja → NUEVAS.
--    - cerrar_turno → create-or-replace con la MISMA firma (conserva permisos);
--      ahora el contado autoritativo es el conteo ya bloqueado si existe, así
--      ni la app ni la voz pueden cerrar con un número distinto.
--    - NO toca resumen_turno ni cuadres_dia (menos riesgo): la app lee el
--      conteo bloqueado directo de shift_sessions, y la jefa deduce "bloqueado
--      sin cerrar" de (status='open' y counted_cash no nulo).
-- ============================================================================

-- ----------------------------------------------------------------------------
--  Marca de cuándo se registró (y bloqueó) el conteo físico.
-- ----------------------------------------------------------------------------
alter table shift_sessions
  add column if not exists counted_at timestamptz;

comment on column shift_sessions.counted_at is
  'Momento en que la encargada registró y BLOQUEÓ el conteo físico de caja, antes de ver lo esperado (anti-robo). null = aún no cuenta.';

-- ----------------------------------------------------------------------------
--  Códigos de evento nuevos para la bitácora (FK activity_events). Idempotente.
-- ----------------------------------------------------------------------------
insert into activity_events (code, label, category, sort_order) values
  ('conteo_caja',    'Conteo de caja (bloqueado)', 'caja', 33),
  ('reabrir_conteo', 'Reapertura de conteo',       'caja', 34)
on conflict (code) do nothing;

-- ============================================================================
--  RPC · registrar_conteo_caja — fija el efectivo contado y lo BLOQUEA.
--   Idempotente: si ya hay conteo (counted_at no nulo) NO lo cambia; solo
--   devuelve la sesión tal cual. Solo aplica a turnos abiertos.
-- ============================================================================
create or replace function registrar_conteo_caja(
  p_session_id   uuid,
  p_counted_cash numeric,
  p_user         uuid
) returns shift_sessions
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_row shift_sessions;
begin
  update shift_sessions ss
     set counted_cash = p_counted_cash,
         counted_at   = now()
   where ss.id = p_session_id
     and ss.status = 'open'
     and ss.counted_at is null        -- candado: no se sobreescribe
   returning ss.* into v_row;

  if v_row.id is not null then
    insert into audit_log(restaurant_id, user_id, shift_session_id, action, entity, entity_id, payload)
    values (v_row.restaurant_id, p_user, v_row.id, 'conteo_caja', 'shift_session', v_row.id,
            jsonb_build_object('counted', v_row.counted_cash));
    return v_row;
  end if;

  -- Ya estaba contado (o cerrado): devolver la fila actual sin tocar nada.
  select * into v_row from shift_sessions where id = p_session_id;
  return v_row;
end;
$$;

-- ============================================================================
--  RPC · reabrir_conteo_caja — SOLO la jefa: borra el conteo bloqueado para
--   corregir un error de digitación. Solo en turnos aún abiertos.
-- ============================================================================
create or replace function reabrir_conteo_caja(
  p_session_id uuid,
  p_admin      uuid
) returns shift_sessions
  language plpgsql
  security definer
  set search_path = public, app
as $$
declare
  v_row shift_sessions;
begin
  update shift_sessions ss
     set counted_cash = null,
         counted_at   = null
   where ss.id = p_session_id
     and ss.status = 'open'
   returning ss.* into v_row;

  if v_row.id is null then
    raise exception 'La sesión % no existe o ya está cerrada', p_session_id;
  end if;

  insert into audit_log(restaurant_id, user_id, shift_session_id, action, entity, entity_id, payload)
  values (v_row.restaurant_id, p_admin, v_row.id, 'reabrir_conteo', 'shift_session', v_row.id,
          jsonb_build_object('reabierto_por', p_admin));
  return v_row;
end;
$$;

-- ============================================================================
--  RPC · cerrar_turno (REEMPLAZO, MISMA firma — conserva permisos)
--   El contado real = el conteo YA bloqueado si se registró; si no, el que
--   llega por parámetro (compatibilidad con el cierre por voz sin pre-conteo).
-- ============================================================================
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
  v_counted  numeric(12,2);
  v_row      shift_sessions;
begin
  select caja_esperada into v_expected
    from v_caja_turno where shift_session_id = p_session_id;

  -- Contado autoritativo: el conteo bloqueado manda sobre el parámetro.
  select coalesce(counted_cash, p_counted_cash) into v_counted
    from shift_sessions where id = p_session_id;

  update shift_sessions ss
     set status           = 'closed',
         expected_cash    = coalesce(v_expected, ss.opening_cash),
         counted_cash     = v_counted,
         closing_float    = coalesce(p_closing_float, ss.opening_cash),
         deposit_amount   = v_counted - coalesce(p_closing_float, ss.opening_cash),
         cash_discrepancy = v_counted - coalesce(v_expected, ss.opening_cash),
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

-- ----------------------------------------------------------------------------
--  Permisos: solo el servidor (service_role); revocadas a anon/authenticated.
-- ----------------------------------------------------------------------------
revoke execute on function registrar_conteo_caja(uuid, numeric, uuid) from public;
revoke execute on function reabrir_conteo_caja(uuid, uuid)            from public;

grant execute on function registrar_conteo_caja(uuid, numeric, uuid) to service_role;
grant execute on function reabrir_conteo_caja(uuid, uuid)            to service_role;

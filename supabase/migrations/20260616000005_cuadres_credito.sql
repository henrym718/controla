-- ============================================================================
--  CONTROLA · Migración · CUADRES: mostrar crédito por turno
--
--  Agrega al cuadre del día (cierre del admin) dos cifras informativas por turno,
--  sin cambiar el cálculo del cuadre de caja (que sigue usando solo el efectivo):
--    - ventas_credito: lo vendido a crédito ese turno (no es efectivo, se cobra
--      después).
--    - cobros_credito: cobros de crédito recibidos ese turno (ya están dentro de
--      los 'aportes'/ingresos de caja; aquí se muestran aparte para entender de
--      dónde vino ese efectivo).
--
--  Solo amplía el jsonb que ya devolvía cuadres_dia (create or replace, aditivo).
--  No toca ninguna migración previa.
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
      (select coalesce(sum(s.total), 0) from sales s where s.shift_session_id = ss.id and s.voided_at is null) as ventas,
      (select coalesce(sum(s.total), 0) from sales s where s.shift_session_id = ss.id and s.payment_method = 'efectivo' and s.voided_at is null) as ventas_efectivo,
      (select coalesce(sum(s.total), 0) from sales s where s.shift_session_id = ss.id and s.payment_method = 'credito' and s.voided_at is null) as ventas_credito,
      (select coalesce(sum(c.amount), 0) from cash_movements c where c.shift_session_id = ss.id and c.categoria = 'cobro_credito' and c.voided_at is null) as cobros_credito,
      (select coalesce(sum(e.amount), 0) from expenses e where e.shift_session_id = ss.id and e.voided_at is null) as gastos,
      (select coalesce(sum(c.amount), 0) from cash_movements c where c.shift_session_id = ss.id and c.type = 'egreso' and c.voided_at is null) as egresos,
      (select coalesce(sum(c.amount), 0) from cash_movements c where c.shift_session_id = ss.id and c.type = 'ingreso' and c.voided_at is null) as aportes
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

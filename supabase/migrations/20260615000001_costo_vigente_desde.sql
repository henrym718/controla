-- ============================================================================
--  CONTROLA · Migración 0015 · VIGENCIA DE COSTOS FIJOS (effective_from)
--
--  Un costo fijo (arriendo, sueldo, internet…) deja de aplicarse "para siempre
--  hacia atrás": ahora tiene una fecha desde la cual rige. Así el estado de
--  resultados, el resumen diario y la analítica no le cargan ese costo a meses
--  o días anteriores a que existiera.
--
--  - effective_from: fecha (en hora de Ecuador) desde la que el costo cuenta.
--  - Backfill: los costos ya cargados rigen desde el día en que se registraron.
--  - Default: hoy en hora de Ecuador (si la app no envía una fecha explícita).
-- ============================================================================

alter table recurring_costs
  add column if not exists effective_from date;

-- Los costos existentes rigen desde el día (hora Ecuador) en que se crearon.
update recurring_costs
   set effective_from = (created_at at time zone 'America/Guayaquil')::date
 where effective_from is null;

alter table recurring_costs
  alter column effective_from set default (now() at time zone 'America/Guayaquil')::date,
  alter column effective_from set not null;

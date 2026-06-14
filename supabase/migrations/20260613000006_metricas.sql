-- ============================================================================
--  CONTROLA · Migración 0006 · MÉTRICAS
--  Ventas promedio por día de la semana (acumulado total, NO filtrado por rango).
--  RPC para que escale: agrupa en la base usando el índice de sales.
-- ============================================================================

create index if not exists idx_sales_restaurant_total on sales(restaurant_id);

create or replace function ventas_por_dia_semana(p_restaurant uuid)
returns table (weekday int, total numeric, dias bigint)
  language sql
  stable
  security definer
  set search_path = public, app
as $$
  select extract(dow from business_date)::int as weekday,
         coalesce(sum(total), 0)              as total,
         count(distinct business_date)        as dias
  from sales
  where restaurant_id = p_restaurant
  group by 1
  order by 1;
$$;

revoke execute on function ventas_por_dia_semana(uuid) from public;
grant execute on function ventas_por_dia_semana(uuid) to service_role;

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeDishHistory, listDishCatalog } from "@/lib/reports";
import { resolveRange } from "@/lib/range";
import { DateRangePicker } from "@/components/date-range";
import { CostoPrecioChart } from "@/components/charts";
import { Card, PageTitle } from "@/components/ui";
import { DishSelect } from "./dish-select";

export default async function HistoricoPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurante: string }>;
  searchParams: Promise<{ dish?: string; preset?: string; from?: string; to?: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);
  if (session.user_role !== "admin") redirect(`/${restaurante}/hoy`);

  const sp = await searchParams;
  const range = resolveRange({ ...sp, preset: sp.preset ?? "30d" });
  const db = createAdminClient();
  const catalog = await listDishCatalog(db, session.restaurant_id);
  const dishId = sp.dish ?? "";

  const history = dishId
    ? await computeDishHistory(db, session.restaurant_id, dishId, range.from, range.to)
    : [];
  const last = history[history.length - 1];
  const enPeligro = last && last.precio > 0 && last.costo / last.precio > 0.7;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Histórico de platos" subtitle="Cómo varía el costo en el tiempo" />
      <DishSelect dishes={catalog.map((d) => ({ id: d.id, name: d.name }))} current={dishId} />
      <DateRangePicker />

      {!dishId && <p className="text-sm opacity-50">Elige un plato para ver su tendencia.</p>}

      {dishId && history.length === 0 && (
        <p className="text-sm opacity-50">
          Sin datos en el periodo. El costo se guarda al cerrar cada día.
        </p>
      )}

      {dishId && history.length > 0 && (
        <>
          {enPeligro && (
            <div className="rounded-3xl bg-peach p-4">
              <p className="font-semibold text-coral">Margen en peligro</p>
              <p className="text-sm opacity-70">
                El costo ya es el {((last.costo / last.precio) * 100).toFixed(0)}% del
                precio. Hora de ajustar precio o porciones.
              </p>
            </div>
          )}
          <Card>
            <div className="mb-2 flex gap-4 text-xs">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-3 rounded-full" style={{ background: "#00a887" }} />
                Precio
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-3 rounded-full" style={{ background: "#ff4d3d" }} />
                Costo
              </span>
            </div>
            <CostoPrecioChart data={history} />
          </Card>
          <Card>
            <div className="flex justify-between text-sm">
              <span className="opacity-60">Último costo registrado</span>
              <span className="font-semibold">${last.costo.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="opacity-60">Precio de venta</span>
              <span className="font-semibold">${last.precio.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="opacity-60">Margen actual</span>
              <span className="font-semibold text-teal">
                ${(last.precio - last.costo).toFixed(2)}
              </span>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

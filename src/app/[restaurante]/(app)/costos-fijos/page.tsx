import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { computePnL } from "@/lib/reports";
import { resolveRange } from "@/lib/range";
import { DateRangePicker } from "@/components/date-range";
import { Card, Stat } from "@/components/ui";
import CostosClient from "./costos-client";

const money = (n: number) => `$${n.toFixed(2)}`;

export default async function CostosFijosPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurante: string }>;
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);
  if (session.user_role !== "admin") redirect(`/${restaurante}/hoy`);

  const range = resolveRange({ ...(await searchParams), preset: (await searchParams).preset ?? "30d" });
  const db = createAdminClient();
  const [pnl, { data: costs }] = await Promise.all([
    computePnL(db, session.restaurant_id, range.from, range.to),
    db
      .from("recurring_costs")
      .select("id,name,amount,category,schedule_type")
      .eq("restaurant_id", session.restaurant_id)
      .eq("active", true)
      .order("category"),
  ]);

  const row = "flex items-center justify-between py-2 text-sm border-b border-ink/5 last:border-0";

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold tracking-tight">Costos fijos y P&amp;L</h1>
      <DateRangePicker />
      <p className="-mt-3 text-xs opacity-50">
        {range.label} · {pnl.dias} días
      </p>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Ventas" value={money(pnl.ventas)} tone="mint" />
        <Stat
          label="Utilidad neta"
          value={money(pnl.utilidadNeta)}
          tone="ink"
          accent={pnl.utilidadNeta >= 0 ? "text-teal" : "text-coral"}
        />
      </div>

      <Card>
        <p className="mb-2 text-sm font-medium opacity-60">Estado de resultados</p>
        <div className={row}><span>Ventas</span><span className="font-semibold">{money(pnl.ventas)}</span></div>
        <div className={row}><span>− Costo directo (insumos)</span><span>{money(pnl.costoDirecto)}</span></div>
        <div className={row}><span className="font-semibold">= Margen de contribución</span><span className="font-semibold">{money(pnl.margenContribucion)}</span></div>
        <div className={row}><span>− Operativo (sueldos, servicios)</span><span>{money(pnl.fijoOperativo)}</span></div>
        <div className={row}><span>− Administrativo (arriendo, internet)</span><span>{money(pnl.fijoAdministrativo)}</span></div>
        <div className={row}><span className="font-semibold">= Utilidad operativa</span><span className="font-semibold">{money(pnl.utilidadOperativa)}</span></div>
        <div className={row}><span>− Financiero (préstamos)</span><span>{money(pnl.fijoFinanciero)}</span></div>
        <div className={row}>
          <span className="font-bold">= Utilidad neta</span>
          <span className={`font-bold ${pnl.utilidadNeta >= 0 ? "text-teal" : "text-coral"}`}>{money(pnl.utilidadNeta)}</span>
        </div>
      </Card>

      {pnl.puntoEquilibrioDiario != null && (
        <Stat
          label="Punto de equilibrio"
          value={`${money(pnl.puntoEquilibrioDiario)}/día`}
          tone="sand"
          hint="Ventas diarias para cubrir los fijos"
        />
      )}

      <CostosClient
        costs={(costs ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          amount: Number(c.amount),
          category: c.category,
          scheduleType: c.schedule_type,
        }))}
      />
    </div>
  );
}

import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeMonthlyPnL } from "@/lib/reports";
import { businessDate } from "@/lib/shifts";
import { BreakEvenChart } from "@/components/charts";
import { Card } from "@/components/ui";

const money = (n: number) => `$${n.toFixed(2)}`;
const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function ym(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default async function BalancePage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurante: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);
  if (session.user_role !== "admin") redirect(`/${restaurante}/hoy`);

  const sp = await searchParams;
  const todayYm = businessDate().slice(0, 7);
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : todayYm;
  const [year, mon] = month.split("-").map(Number);

  const db = createAdminClient();
  const pnl = await computeMonthlyPnL(db, session.restaurant_id, year, mon);

  const base = `/${restaurante}/balance`;
  const prev = ym(new Date(year, mon - 2, 1));
  const next = ym(new Date(year, mon, 1));
  const atCurrent = month >= todayYm;

  const row = "flex items-center justify-between py-2 text-sm border-b border-ink/5 last:border-0";
  const chev =
    "flex h-10 w-10 items-center justify-center rounded-full bg-ink/5 text-xl font-bold";

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">Estado de resultados</h1>

      <div className="flex items-center justify-center gap-3">
        <Link href={`${base}?month=${prev}`} className={chev}>
          ‹
        </Link>
        <p className="min-w-40 text-center text-base font-bold capitalize">
          {MESES[mon - 1]} {year}
        </p>
        {atCurrent ? (
          <span className={`${chev} opacity-20`}>›</span>
        ) : (
          <Link href={`${base}?month=${next}`} className={chev}>
            ›
          </Link>
        )}
      </div>

      {pnl.enCurso && (
        <p className="rounded-2xl bg-sand px-3 py-2 text-center text-xs">
          Mes en curso · {pnl.daysElapsed} de {pnl.daysInMonth} días. Los valores siguen creciendo hasta
          fin de mes.
        </p>
      )}

      <div className="rounded-3xl bg-ink p-5 text-white">
        <p className="text-xs text-white/60">Utilidad neta del mes</p>
        <p className={`text-3xl font-bold ${pnl.utilidadNeta >= 0 ? "text-teal" : "text-coral"}`}>
          {money(pnl.utilidadNeta)}
        </p>
      </div>

      <Card>
        <p className="mb-2 text-sm font-medium opacity-60">Detalle del mes</p>
        <div className={row}><span>Ventas</span><span className="font-semibold text-teal">{money(pnl.ventas)}</span></div>
        <div className={row}><span>− Costo directo (insumos cocinados)</span><span>{money(pnl.costoDirecto)}</span></div>
        <div className={row}><span className="font-semibold">= Margen de contribución</span><span className="font-semibold">{money(pnl.margenContribucion)}</span></div>
        <div className={row}><span>− Operativo (sueldos, servicios)</span><span>{money(pnl.fijoOperativo)}</span></div>
        <div className={row}><span>− Administrativo (arriendo, internet)</span><span>{money(pnl.fijoAdministrativo)}</span></div>
        <div className={row}><span className="font-semibold">= Utilidad operativa</span><span className="font-semibold">{money(pnl.utilidadOperativa)}</span></div>
        <div className={row}><span>− Financiero (préstamos)</span><span>{money(pnl.fijoFinanciero)}</span></div>
        <div className={row}>
          <span className="font-bold">= Utilidad neta</span>
          <span className={`font-bold ${pnl.utilidadNeta >= 0 ? "text-teal" : "text-coral"}`}>
            {money(pnl.utilidadNeta)}
          </span>
        </div>
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Punto de equilibrio</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-3xl bg-lav p-4">
            <p className="text-xs opacity-60">Necesitas vender al día</p>
            <p className="text-2xl font-bold">
              {pnl.puntoEquilibrioDiario != null ? money(pnl.puntoEquilibrioDiario) : "—"}
            </p>
          </div>
          <div className="rounded-3xl bg-mint p-4">
            <p className="text-xs opacity-60">Vendes al día (promedio)</p>
            <p className="text-2xl font-bold">{money(pnl.ventaDiariaProm)}</p>
          </div>
        </div>
        <Card>
          <BreakEvenChart data={pnl.proyeccion} />
        </Card>
        <p className="rounded-2xl bg-ink/[0.03] px-3 py-2 text-xs opacity-70">
          {pnl.diasParaEquilibrio != null ? (
            <>
              Al ritmo actual cubres los costos fijos del mes (<b>{money(pnl.fijoTotal)}</b>) cerca del{" "}
              <b>día {pnl.diasParaEquilibrio}</b>. La línea cruza el $0 ese día: desde ahí, lo demás es
              ganancia.
            </>
          ) : (
            <>Aún no hay suficientes ventas este mes para proyectar el punto de equilibrio.</>
          )}
        </p>
      </section>
    </div>
  );
}

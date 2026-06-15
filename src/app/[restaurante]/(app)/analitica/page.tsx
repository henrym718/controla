import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeAnalytics } from "@/lib/reports";
import { resolveRange } from "@/lib/range";
import { DateRangePicker } from "@/components/date-range";
import { Heatmap } from "@/components/heatmap";
import { MermaLineChart, DesfaseBarChart, VentasDiaChart, VentasCostosChart } from "@/components/charts";
import { Card } from "@/components/ui";

const money = (n: number) => `$${n.toFixed(2)}`;
const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

function Nota({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl bg-ink/[0.03] px-3 py-2 text-xs opacity-70">{children}</p>;
}

export default async function AnaliticaPage({
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

  const range = resolveRange(await searchParams);
  const db = createAdminClient();
  const [a, { data: vds }] = await Promise.all([
    computeAnalytics(db, session.restaurant_id, range.from, range.to),
    db.rpc("ventas_por_dia_semana", { p_restaurant: session.restaurant_id }),
  ]);

  const promedioDia = ORDER.map((i) => {
    const r = (vds ?? []).find((x) => x.weekday === i);
    const avg = r && Number(r.dias) > 0 ? Number(r.total) / Number(r.dias) : 0;
    return { label: WEEKDAYS[i], ventas: avg };
  });

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold tracking-tight">Tablero de control</h1>
      <DateRangePicker />
      <p className="-mt-3 text-xs opacity-50">{range.label} · {range.from} → {range.to}</p>

      <p className="rounded-2xl bg-ink/[0.03] px-3 py-2 text-xs opacity-60">
        Aquí están los KPIs de operación. La utilidad, el margen y el punto de equilibrio del mes
        viven en <b>Estado de resultados</b>.
      </p>

      {/* TENDENCIA: VENTAS VS COSTOS POR DÍA */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Ventas vs costos por día</h2>
        <Card>
          <VentasCostosChart data={a.serieDiaria} />
        </Card>
        <Nota>
          Cómo leer: las <b>barras</b> son lo que vendiste cada día; la <b>línea</b> es lo que te
          costó ese día (comida + gastos del día + fijos prorrateados). El <b>espacio entre la barra
          y la línea es tu ganancia</b>. Si la línea se pega o pasa la barra, ese día trabajaste casi
          gratis o perdiste: mira las compras, la merma o el personal de ese día. La caída brusca de
          una barra marca un día flojo de ventas.
        </Nota>
      </section>

      {/* GASTOS OPERATIVOS (no inventario) */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Gastos operativos (no inventario)</h2>
        <div className="rounded-3xl bg-sand p-4">
          <p className="text-xs font-medium opacity-60">
            Total del periodo (servilletas, escoba, propinas, desinfectante…)
          </p>
          <p className="text-2xl font-bold">{money(a.gastos)}</p>
        </div>
        {a.gastosItems.length > 0 ? (
          <Card>
            <p className="mb-2 text-sm font-medium opacity-60">Por concepto</p>
            {a.gastosItems.map((g) => (
              <div key={g.name} className="flex items-center justify-between border-b border-ink/5 py-2 text-sm last:border-0">
                <span className="capitalize">{g.name}</span>
                <span className="font-semibold">{money(g.cost)}</span>
              </div>
            ))}
          </Card>
        ) : (
          <Nota>
            Aún no hay gastos no-inventario en este rango. Regístralos por voz: “compré
            servilletas por $2 de caja”.
          </Nota>
        )}
        {a.gastosPorResponsable.length > 0 && (
          <Card>
            <p className="mb-2 text-sm font-medium opacity-60">Por responsable</p>
            {a.gastosPorResponsable.map((r) => (
              <div key={r.responsable} className="flex items-center justify-between border-b border-ink/5 py-2 text-sm last:border-0">
                <span>{r.responsable} <span className="opacity-50">· {r.n}</span></span>
                <span className="font-semibold">{money(r.total)}</span>
              </div>
            ))}
          </Card>
        )}
        <Nota>
          Cómo leer: gastos que <b>no</b> entran al inventario (limpieza, descartables,
          propinas, servicios menores). Ya bajan la <b>utilidad neta</b> de arriba. Sirve para
          ver en qué se va la plata del día a día y quién la registró.
        </Nota>
      </section>

      {/* MAPA DE CALOR */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Días y turnos</h2>
        <Card>
          <Heatmap rows={a.heatmap} shiftCols={a.shiftCols} />
        </Card>
        <Nota>
          Cómo leer: cada celda es un turno de un día. En <b>Dinero</b> ves la venta y el
          sueldo de ese turno; <b>verde</b> = la venta cubre el sueldo, <b>rojo</b> = pagas más
          de lo que vende. En <b>% sueldo</b>, lo sano es ≤35%. Sirve para decidir qué turno
          recortar personal o cerrar.
        </Nota>
      </section>

      {/* DÍAS MÁS VENDIDOS (promedio, histórico) */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Días que más se vende</h2>
        <Card>
          <VentasDiaChart data={promedioDia} />
        </Card>
        <Nota>
          Cómo leer: venta <b>promedio</b> de cada día de la semana (histórico completo, no
          cambia con el filtro de arriba). Sirve para comprar más insumos los días fuertes y
          bajar la producción los flojos.
        </Nota>
      </section>

      {/* RENTABILIDAD DE PLATOS */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Rentabilidad de platos</h2>
        <Card>
          <div className="flex border-b border-ink/10 pb-1 text-xs font-semibold opacity-60">
            <span className="flex-1">Plato</span>
            <span className="w-16 text-right">Margen</span>
            <span className="w-20 text-right">$/día</span>
          </div>
          {a.platos.length === 0 && (
            <p className="py-3 text-sm opacity-50">Cierra días para calcular la rentabilidad.</p>
          )}
          {a.platos.map((p) => (
            <div key={p.name} className="flex items-center border-b border-ink/5 py-2 text-sm last:border-0">
              <div className="flex-1">
                <p className="font-medium">{p.name}</p>
                <p className="text-[11px] opacity-50">{p.dias} día(s) servido</p>
              </div>
              <span className="w-16 text-right">{p.margenPct.toFixed(0)}%</span>
              <span className={`w-20 text-right font-bold ${p.gananciaPorDia >= 0 ? "text-teal" : "text-coral"}`}>
                {money(p.gananciaPorDia)}
              </span>
            </div>
          ))}
        </Card>
        <Nota>
          Cómo leer: <b>ganancia por día servido</b> (no por volumen total). Un plato que se
          hace 2 días puede dejar más que el de todos los días. Sirve para meter más seguido
          los platos que más dejan y sacar los que no.
        </Nota>
      </section>

      {/* MERMA HISTÓRICA */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Rastreador de merma</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-3xl bg-sand p-4">
            <p className="text-xs font-medium opacity-60">Merma del periodo</p>
            <p className="text-2xl font-bold">{money(a.mermaTotal)}</p>
          </div>
          <div className="rounded-3xl bg-sand p-4">
            <p className="text-xs font-medium opacity-60">% del pool desperdiciado</p>
            <p className="text-2xl font-bold">{a.indiceContraccion.toFixed(0)}%</p>
          </div>
        </div>
        <Card>
          <MermaLineChart data={a.mermaPorDia} />
        </Card>
        <Nota>
          Cómo leer: dinero <b>botado</b> cada día. Si la línea sube, estás cocinando de más o
          se está dañando comida. Sirve para ajustar el pool y dejar de botar plata.
        </Nota>
        {a.mermaInsight && (
          <div className="rounded-2xl bg-peach px-4 py-3 text-sm">
            <span className="font-semibold">Alerta: </span>{a.mermaInsight}
          </div>
        )}
      </section>

      {/* DESFASES */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Desfases (dinero evaporado)</h2>
        <div className="rounded-3xl bg-ink p-5 text-white">
          <p className="text-xs font-medium text-white/60">Dinero evaporado en el periodo</p>
          <p className={`text-4xl font-bold ${a.desfaseTotal < 0 ? "text-coral" : "text-teal"}`}>
            {money(a.desfaseTotal)}
          </p>
        </div>
        <Card>
          <DesfaseBarChart data={a.desfasePorDia} />
        </Card>
        <Nota>
          Cómo leer: plata que <b>faltó</b> = descuadre de caja al cerrar + ajustes de conteo
          de inventario. Los picos suelen ser los días de conteo. Sirve para ver cuánto se
          evapora y quién estaba a cargo.
        </Nota>
        {a.desfasePorResponsable.length > 0 && (
          <Card>
            <p className="mb-2 text-sm font-medium opacity-60">Por responsable</p>
            {a.desfasePorResponsable.map((r) => (
              <div key={r.responsable} className="flex items-center justify-between border-b border-ink/5 py-2 text-sm last:border-0">
                <span>{r.responsable} <span className="opacity-50">· {r.n}</span></span>
                <span className={`font-semibold ${r.total < -0.005 ? "text-coral" : ""}`}>{money(r.total)}</span>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}

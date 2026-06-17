"use client";

import { useState } from "react";
import { DayNav } from "@/components/day-nav";
import { Card } from "@/components/ui";
import type { DaySales, DaySaleEntry } from "@/lib/reports";

const money = (n: number) => `$${n.toFixed(2)}`;

const PAGO: Record<string, string> = {
  efectivo: "Efectivo",
  credito: "Fiado",
  transferencia: "Transfer.",
  otro: "Otro",
};

export default function VentasDiaClient({
  today,
  initial,
}: {
  today: string;
  initial: DaySales;
}) {
  const [date, setDate] = useState(today);
  const [data, setData] = useState<DaySales>(initial);
  const [loading, setLoading] = useState(false);

  async function change(d: string) {
    setDate(d);
    setLoading(true);
    try {
      const res = await fetch(`/api/ventas-dia?date=${d}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  const { entries, resumen } = data;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">Ventas del día</h1>
      <DayNav value={date} today={today} onChange={change} />
      <p className="-mt-1 text-center text-xs opacity-50">
        A qué hora se vendió cada plato, y quién lo registró.
      </p>

      <div className={loading ? "pointer-events-none opacity-50 transition" : "transition"}>
        <div className="flex flex-col gap-4">
          {entries.length === 0 ? (
            <p className="rounded-2xl bg-ink/[0.03] px-3 py-8 text-center text-sm opacity-60">
              No hubo ventas registradas este día.
            </p>
          ) : (
            <>
              {/* DETALLE: cada venta con su hora, en orden de la mañana a la noche */}
              <section className="flex flex-col gap-2">
                {entries.map((e) => (
                  <VentaCard key={e.id} e={e} />
                ))}
              </section>

              {/* RESUMEN: platos agrupados por nombre (cuántos se vendieron) */}
              <section className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide opacity-50">
                  Resumen de platos
                </p>
                <Card>
                  {resumen.map((r) => (
                    <div
                      key={r.name}
                      className="flex items-center justify-between border-b border-ink/5 py-3 last:border-0"
                    >
                      <span className="text-base font-medium">{r.name}</span>
                      <span className="text-2xl font-bold tabular-nums">{r.qty}</span>
                    </div>
                  ))}
                </Card>
                <p className="text-center text-xs opacity-50">
                  {data.totalPlatos} plato{data.totalPlatos === 1 ? "" : "s"} · {money(data.totalVentas)}
                </p>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function VentaCard({ e }: { e: DaySaleEntry }) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight">
            {e.dishName}
            {e.qty > 1 && <span className="opacity-50"> ×{e.qty}</span>}
          </p>
          <p className="mt-0.5 truncate text-xs opacity-50">
            {e.persona}
            {e.pago !== "efectivo" && (
              <span className={e.pago === "credito" ? "font-semibold text-coral" : ""}>
                {" · "}
                {PAGO[e.pago] ?? e.pago}
              </span>
            )}
          </p>
        </div>
        <div className="shrink-0 rounded-2xl bg-ink px-4 py-2 text-center text-white">
          <p className="text-[10px] font-medium uppercase tracking-wide text-white/50">Hora</p>
          <p className="whitespace-nowrap text-xl font-bold leading-none">{e.hora}</p>
        </div>
      </div>
    </Card>
  );
}

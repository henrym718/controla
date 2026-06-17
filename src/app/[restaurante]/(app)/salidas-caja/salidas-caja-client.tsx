"use client";

import { useState } from "react";
import { DayNav } from "@/components/day-nav";
import type { DaySalidas, DaySalida } from "@/lib/reports";

const money = (n: number) => `$${n.toFixed(2)}`;

const TIPO: Record<DaySalida["tipo"], { label: string; cls: string }> = {
  gasto: { label: "Gasto", cls: "bg-coral/15 text-coral" },
  compra: { label: "Compra", cls: "bg-sand text-ink" },
  retiro: { label: "Retiro", cls: "bg-ink/10 text-ink" },
};

export default function SalidasCajaClient({
  today,
  initial,
}: {
  today: string;
  initial: DaySalidas;
}) {
  const [date, setDate] = useState(today);
  const [s, setS] = useState<DaySalidas>(initial);
  const [loading, setLoading] = useState(false);

  async function change(d: string) {
    setDate(d);
    setLoading(true);
    try {
      const res = await fetch(`/api/salidas?date=${d}`);
      if (res.ok) setS(await res.json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">Salidas de caja</h1>
      <DayNav value={date} today={today} onChange={change} />

      <div className={loading ? "pointer-events-none opacity-50 transition" : "transition"}>
        <div className="flex flex-col gap-4">
          {/* Total desembolsado del día — grande y visible */}
          <div className="relative overflow-hidden rounded-[28px] bg-ink p-6 text-white">
            <span className="blob absolute -right-6 -top-8 h-24 w-24 bg-coral/40" />
            <p className="relative text-xs font-medium text-white/60">Salió de la caja este día</p>
            <p className="relative text-4xl font-bold text-white">{money(s.total)}</p>
            <p className="relative mt-1 text-xs text-white/50">
              {s.items.length} {s.items.length === 1 ? "movimiento" : "movimientos"} · gastos + compras + retiros
            </p>
          </div>

          {/* Detalle, letra grande */}
          <div className="flex flex-col gap-2.5">
            {s.items.map((it, idx) => {
              const t = TIPO[it.tipo];
              return (
                <div
                  key={idx}
                  className="flex items-center gap-3 rounded-2xl border border-ink/10 bg-white px-4 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-semibold leading-tight break-words">{it.nombre}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${t.cls}`}>
                        {t.label}
                      </span>
                      {it.detalle && <span className="text-sm opacity-60">{it.detalle}</span>}
                      <span className="text-xs opacity-50">
                        {it.fuente === "jefa" ? "lo puso la jefa" : "de la caja"}
                      </span>
                    </div>
                  </div>
                  <span className="shrink-0 text-xl font-bold">{money(it.monto)}</span>
                </div>
              );
            })}

            {s.items.length === 0 && (
              <p className="rounded-2xl bg-ink/[0.03] px-4 py-10 text-center text-sm opacity-60">
                No salió dinero de la caja este día.
              </p>
            )}
          </div>

          <p className="text-center text-xs opacity-50">
            Suma todo lo que se desembolsó (pagado de la caja o por la jefa). Las compras entran a
            stock; no bajan la utilidad, pero sí salieron de caja.
          </p>
        </div>
      </div>
    </div>
  );
}

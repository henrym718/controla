"use client";

import { useState } from "react";
import { DayNav } from "@/components/day-nav";
import { Card } from "@/components/ui";

export interface CuadreTurno {
  id: string;
  shift: string;
  sort_order: number | null;
  opened_at: string;
  closed_at: string | null;
  status: string;
  responsable: string | null;
  cerro_por: string | null;
  opening_cash: number;
  esperada: number | null;
  counted_cash: number | null;
  cash_discrepancy: number | null;
  closing_float: number | null;
  deposit_amount: number | null;
  ventas: number;
  ventas_efectivo: number;
  ventas_credito?: number;
  cobros_credito?: number;
  gastos: number;
  egresos: number;
  aportes: number;
}

export interface CuadresDia {
  date: string;
  turnos: CuadreTurno[];
}

const money = (n: number | null | undefined) => `$${(Number(n) || 0).toFixed(2)}`;

function hora(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

export default function CuadresClient({
  today,
  initial,
  cuentasMesa,
}: {
  today: string;
  initial: CuadresDia;
  cuentasMesa: { count: number; total: number };
}) {
  const [date, setDate] = useState(today);
  const [data, setData] = useState<CuadresDia>(initial);
  const [loading, setLoading] = useState(false);

  async function change(d: string) {
    setDate(d);
    setLoading(true);
    try {
      const res = await fetch(`/api/cuadres?date=${d}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  const turnos = data?.turnos ?? [];
  const cerrados = turnos.filter((t) => t.status === "closed");
  const totVentas = turnos.reduce((s, t) => s + Number(t.ventas), 0);
  const totDescuadre = cerrados.reduce((s, t) => s + Number(t.cash_discrepancy ?? 0), 0);
  const totEntregado = cerrados.reduce((s, t) => s + Number(t.deposit_amount ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">Cuadres de caja</h1>
      <DayNav value={date} today={today} onChange={change} />

      {cuentasMesa.count > 0 && (
        <div className="rounded-2xl border border-coral/30 bg-coral/5 px-4 py-3">
          <p className="text-sm font-bold text-coral">
            🧾 {cuentasMesa.count} cuenta{cuentasMesa.count === 1 ? "" : "s"} de mesa abierta
            {cuentasMesa.count === 1 ? "" : "s"} ({money(cuentasMesa.total)})
          </p>
          <p className="mt-0.5 text-xs opacity-70">
            Comida servida sin cobrar todavía. Se cobran en “Vender → Cuentas abiertas”.
          </p>
        </div>
      )}

      <div className={loading ? "pointer-events-none opacity-50 transition" : "transition"}>
        <div className="flex flex-col gap-4">
          {/* Totales del día */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-3xl bg-mint p-3 text-center">
              <p className="text-[11px] font-medium opacity-60">Ventas</p>
              <p className="text-lg font-bold">{money(totVentas)}</p>
            </div>
            <div className="rounded-3xl bg-lav p-3 text-center">
              <p className="text-[11px] font-medium opacity-60">Entregado</p>
              <p className="text-lg font-bold">{money(totEntregado)}</p>
            </div>
            <div className={`rounded-3xl p-3 text-center ${Math.abs(totDescuadre) < 0.005 ? "bg-sand" : "bg-peach"}`}>
              <p className="text-[11px] font-medium opacity-60">Descuadre</p>
              <p className={`text-lg font-bold ${totDescuadre < -0.005 ? "text-coral" : ""}`}>
                {money(totDescuadre)}
              </p>
            </div>
          </div>

          {turnos.length === 0 && (
            <p className="rounded-2xl bg-ink/[0.03] px-3 py-6 text-center text-sm opacity-60">
              No hubo turnos este día.
            </p>
          )}

          {turnos.map((t) => (
            <TurnoCard key={t.id} t={t} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TurnoCard({ t }: { t: CuadreTurno }) {
  const cerrado = t.status === "closed";
  const dif = Number(t.cash_discrepancy ?? 0);
  const cuadra = Math.abs(dif) < 0.005;
  const costos = Number(t.gastos) + Number(t.egresos);
  const sub = "flex items-center justify-between py-1 text-xs opacity-70";

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-base font-bold">{t.shift}</p>
          <p className="text-xs opacity-50">
            {t.responsable ?? "—"}
            {cerrado && t.cerro_por && t.cerro_por !== t.responsable
              ? ` · cerró ${t.cerro_por}`
              : ""}
            {cerrado && t.closed_at ? ` · ${hora(t.closed_at)}` : ""}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            cerrado ? "bg-ink/5" : "bg-mint"
          }`}
        >
          {cerrado ? "Cerrado" : "Abierto"}
        </span>
      </div>

      {/* Ventas / costos */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-ink/[0.03] p-3">
          <p className="text-[11px] opacity-60">Ventas</p>
          <p className="text-base font-bold">{money(t.ventas)}</p>
          <p className="text-[11px] opacity-50">Efectivo {money(t.ventas_efectivo)}</p>
          {Number(t.ventas_credito ?? 0) > 0 && (
            <p className="text-[11px] font-semibold text-coral">
              Crédito {money(t.ventas_credito)}
            </p>
          )}
        </div>
        <div className="rounded-2xl bg-ink/[0.03] p-3">
          <p className="text-[11px] opacity-60">Costos</p>
          <p className="text-base font-bold">{money(costos)}</p>
          <p className="text-[11px] opacity-50">
            Gastos {money(t.gastos)} · Compras {money(t.egresos)}
          </p>
        </div>
      </div>

      {/* Caja */}
      <div className="mt-3 border-t border-ink/5 pt-2">
        <div className={sub}><span>Caja inicial</span><span>{money(t.opening_cash)}</span></div>
        {Number(t.aportes) > 0 && (
          <div className={sub}><span>+ Aportes (jefa / ingresos)</span><span>{money(t.aportes)}</span></div>
        )}
        {Number(t.cobros_credito ?? 0) > 0 && (
          <div className={sub}><span>↳ incluye cobros de crédito</span><span>{money(t.cobros_credito)}</span></div>
        )}
        <div className="flex items-center justify-between py-1 text-xs font-semibold">
          <span>{cerrado ? "= Caja esperada" : "= Caja esperada (en vivo)"}</span>
          <span>{money(t.esperada)}</span>
        </div>

        {cerrado ? (
          <>
            <div className="flex items-center justify-between py-1 text-sm">
              <span className="opacity-60">Contada</span>
              <span className="font-semibold">{money(t.counted_cash)}</span>
            </div>
            <div className="flex items-center justify-between py-1 text-sm">
              <span className="opacity-60">Descuadre</span>
              <span className={`font-bold ${cuadra ? "text-teal" : "text-coral"}`}>
                {money(dif)}
                <span className="ml-1 text-[11px] font-normal opacity-60">
                  {cuadra ? "cuadra" : dif < 0 ? "falta" : "sobra"}
                </span>
              </span>
            </div>
          </>
        ) : (
          <p className="py-1 text-xs italic opacity-50">Turno en curso · aún sin cuadrar.</p>
        )}
      </div>

      {/* Entrega de efectivo */}
      {cerrado && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-sand p-3">
            <p className="text-[11px] opacity-60">Caja que dejó</p>
            <p className="text-base font-bold">{money(t.closing_float)}</p>
          </div>
          <div className="rounded-2xl bg-lav p-3">
            <p className="text-[11px] opacity-60">Efectivo entregado</p>
            <p className="text-base font-bold">{money(t.deposit_amount)}</p>
          </div>
        </div>
      )}
    </Card>
  );
}

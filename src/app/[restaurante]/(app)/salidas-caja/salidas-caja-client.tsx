"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DayNav } from "@/components/day-nav";
import { registrarMovimientoCapital } from "../admin/actions";
import type { DaySalidas, DaySalida, FlujoCaja } from "@/lib/reports";

const money = (n: number) => `$${n.toFixed(2)}`;

const TIPO: Record<DaySalida["tipo"], { label: string; cls: string }> = {
  gasto: { label: "Gasto", cls: "bg-coral/15 text-coral" },
  compra: { label: "Compra", cls: "bg-sand text-ink" },
  retiro: { label: "Retiro", cls: "bg-ink/10 text-ink" },
};

// Orden de las secciones del detalle: primero compras, luego gastos, luego retiros.
const ORDEN: { tipo: DaySalida["tipo"]; titulo: string }[] = [
  { tipo: "compra", titulo: "Compras" },
  { tipo: "gasto", titulo: "Gastos" },
  { tipo: "retiro", titulo: "Retiros / otros" },
];

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
  const [showFlujo, setShowFlujo] = useState(false);

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
          {/* Entró vs Salió del día — rápido */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[24px] bg-mint p-5">
              <p className="text-xs font-medium opacity-60">Entró este día</p>
              <p className="text-3xl font-bold leading-tight">{money(s.entro)}</p>
              <p className="mt-1 text-xs opacity-60">ventas + aportes</p>
            </div>
            <button
              onClick={() => setShowFlujo(true)}
              className="relative overflow-hidden rounded-[24px] bg-ink p-5 text-left text-white"
            >
              <span className="absolute right-3 top-3 rounded-full bg-white/15 px-2 py-1 text-[10px] font-semibold">
                ver flujo ›
              </span>
              <p className="text-xs font-medium text-white/60">Salió este día</p>
              <p className="text-3xl font-bold leading-tight">{money(s.total)}</p>
              <p className="mt-1 text-xs text-white/50">
                {s.items.length} {s.items.length === 1 ? "movimiento" : "movimientos"}
              </p>
            </button>
          </div>

          {/* Detalle agrupado por tipo */}
          {s.items.length === 0 ? (
            <p className="rounded-2xl bg-ink/[0.03] px-4 py-10 text-center text-sm opacity-60">
              No salió dinero de la caja este día.
            </p>
          ) : (
            ORDEN.map(({ tipo, titulo }) => {
              const filas = s.items
                .filter((it) => it.tipo === tipo)
                .sort((a, b) => b.monto - a.monto);
              if (filas.length === 0) return null;
              const sub = filas.reduce((acc, it) => acc + it.monto, 0);
              return (
                <div key={tipo} className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between px-1">
                    <p className="text-base font-bold">
                      {titulo} <span className="opacity-40">· {filas.length}</span>
                    </p>
                    <p className="text-sm font-semibold opacity-60">{money(sub)}</p>
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {filas.map((it, idx) => {
                      const t = TIPO[it.tipo];
                      return (
                        <div
                          key={idx}
                          className="flex items-center gap-3 rounded-2xl border border-ink/10 bg-white px-4 py-4"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-lg font-semibold leading-tight break-words">
                              {it.nombre}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span
                                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${t.cls}`}
                              >
                                {t.label}
                              </span>
                              {it.detalle && <span className="text-sm opacity-60">{it.detalle}</span>}
                              <span className="text-xs opacity-50">
                                {it.fuente === "jefa" ? "lo puso la jefa" : "de la caja"}
                              </span>
                              {it.responsable && (
                                <span className="text-xs opacity-50">· registró {it.responsable}</span>
                              )}
                            </div>
                          </div>
                          <span className="shrink-0 text-xl font-bold">{money(it.monto)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}

          <p className="text-center text-xs opacity-50">
            Suma todo lo que se desembolsó (pagado de la caja o por la jefa). Las compras entran a
            stock; no bajan la utilidad, pero sí salieron de caja. Toca «Salió» para ver el flujo de
            caja del negocio.
          </p>
        </div>
      </div>

      {showFlujo && <FlujoModal onClose={() => setShowFlujo(false)} onChanged={() => change(date)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Modal de Flujo de caja (capital acumulado del negocio)
// ---------------------------------------------------------------------------
function FlujoModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const router = useRouter();
  const [flujo, setFlujo] = useState<FlujoCaja | null>(null);
  const [form, setForm] = useState<"ingreso" | "retiro" | null>(null);

  const load = async () => {
    const res = await fetch("/api/flujo");
    if (res.ok) setFlujo(await res.json());
  };
  // Carga inicial al abrir el modal
  useEffect(() => {
    load();
  }, []);

  const afterChange = async () => {
    setForm(null);
    await load();
    onChanged();
    router.refresh();
  };

  const row = "flex items-center justify-between py-1.5 text-sm border-b border-ink/5 last:border-0";

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-lg font-bold">Flujo de caja del negocio</p>
          <button onClick={onClose} className="text-sm font-semibold opacity-50">
            Cerrar
          </button>
        </div>

        {!flujo ? (
          <p className="py-10 text-center text-sm opacity-50">Cargando…</p>
        ) : form ? (
          <CapitalForm tipo={form} capital={flujo.capital} onCancel={() => setForm(null)} onDone={afterChange} />
        ) : (
          <>
            {/* Dinero que queda — grande */}
            <div className="relative overflow-hidden rounded-[24px] bg-ink p-6 text-white">
              <span className="blob absolute -right-6 -top-8 h-24 w-24 bg-teal/40" />
              <p className="relative text-xs font-medium text-white/60">Dinero que queda (capital)</p>
              <p
                className={`relative text-4xl font-bold ${
                  flujo.capital >= 0 ? "text-teal" : "text-coral"
                }`}
              >
                {money(flujo.capital)}
              </p>
              <p className="relative mt-1 text-xs text-white/50">
                lo que el negocio tiene para entregarle a la dueña
              </p>
            </div>

            {/* Mini estado de cuenta */}
            <div className="mt-4 rounded-2xl bg-ink/[0.03] px-4 py-2">
              <div className={row}>
                <span className="text-teal">+ Ventas cobradas</span>
                <span className="font-semibold">{money(flujo.ventas)}</span>
              </div>
              <div className={row}>
                <span className="text-teal">+ Aportes y cobros de fiado</span>
                <span className="font-semibold">{money(flujo.aportes + flujo.ingresosCapital)}</span>
              </div>
              <div className={row}>
                <span>− Compras de inventario</span>
                <span>{money(flujo.compras)}</span>
              </div>
              <div className={row}>
                <span>− Gastos</span>
                <span>{money(flujo.gastos)}</span>
              </div>
              <div className={row}>
                <span>− Retiros de caja</span>
                <span>{money(flujo.retirosCaja)}</span>
              </div>
              <div className={row}>
                <span className="text-coral">− Entregado a la dueña</span>
                <span>{money(flujo.retirosCapital)}</span>
              </div>
              <div className={row}>
                <span>± Excedentes / faltantes (cuadres)</span>
                <span className={flujo.ajusteCuadres >= 0 ? "text-teal" : "text-coral"}>
                  {money(flujo.ajusteCuadres)}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 text-base font-bold">
                <span>= Dinero que queda</span>
                <span className={flujo.capital >= 0 ? "text-teal" : "text-coral"}>
                  {money(flujo.capital)}
                </span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={() => setForm("ingreso")}
                className="rounded-full bg-mint py-3 text-sm font-bold text-ink"
              >
                La jefa mandó plata
              </button>
              <button
                onClick={() => setForm("retiro")}
                className="rounded-full bg-coral py-3 text-sm font-bold text-white"
              >
                Entregué a la dueña
              </button>
            </div>

            <p className="mt-3 text-center text-[11px] opacity-50">
              Cuando entregas todo a la dueña, registra el retiro y el capital vuelve a ~0: empiezas
              de nuevo.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function CapitalForm({
  tipo,
  capital,
  onCancel,
  onDone,
}: {
  tipo: "ingreso" | "retiro";
  capital: number;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const inputCls =
    "w-full rounded-xl border border-ink/15 px-3 py-2.5 text-base outline-none focus:border-ink/40";

  const esRetiro = tipo === "retiro";

  const submit = () => {
    setMsg(null);
    const amt = Number(amount) || 0;
    if (!(amt > 0)) return setMsg("Indica el monto.");
    start(async () => {
      const r = await registrarMovimientoCapital({ type: tipo, amount: amt, reason: reason.trim() || null });
      if (r.error) setMsg(r.error);
      else onDone();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-lg font-bold">
        {esRetiro ? "Entregar a la dueña (retiro)" : "La jefa mandó plata (ingreso)"}
      </p>
      <p className="text-xs opacity-60">
        {esRetiro
          ? "Baja el capital del negocio. Para dejarlo en cero, pon todo lo que queda."
          : "Sube el capital del negocio: plata que la jefa pone para trabajar."}
      </p>

      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
        inputMode="decimal"
        autoFocus
        placeholder="Monto $"
        className={inputCls}
      />
      {esRetiro && (
        <button
          type="button"
          onClick={() => setAmount(String(Math.max(0, Math.round(capital * 100) / 100)))}
          className="self-start rounded-full bg-ink/5 px-3 py-1.5 text-xs font-semibold"
        >
          Entregar todo ({money(capital)})
        </button>
      )}
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Motivo (opcional)"
        className={inputCls}
      />

      <div className="mt-1 flex gap-2">
        <button
          onClick={submit}
          disabled={pending}
          className={`flex-1 rounded-full py-3 font-semibold text-white ${
            esRetiro ? "bg-coral" : "bg-ink"
          }`}
        >
          {pending ? "Guardando…" : esRetiro ? "Registrar retiro" : "Registrar ingreso"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-full border border-ink/15 px-5 py-3 font-semibold"
        >
          Cancelar
        </button>
      </div>
      {msg && <p className="text-center text-sm text-coral">{msg}</p>}
    </div>
  );
}

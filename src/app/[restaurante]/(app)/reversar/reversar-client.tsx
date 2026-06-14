"use client";

import { useState, useTransition } from "react";
import { PageTitle } from "@/components/ui";
import { anularOperacion } from "../admin/actions";

export interface Operacion {
  op_id: string;
  event_code: string;
  event_label: string;
  category: string;
  description: string;
  actor_name: string | null;
  source: string;
  created_at: string;
  anulada: boolean;
}

const inputCls =
  "w-full rounded-xl border border-ink/15 px-3 py-2 text-sm outline-none focus:border-ink/40";

const TONE: Record<string, string> = {
  venta: "bg-teal/15 text-teal",
  compra: "bg-peach",
  gasto: "bg-sand",
  ingreso_caja: "bg-mint",
  egreso_caja: "bg-lav",
};

function horaLocal(iso: string): string {
  return new Date(iso).toLocaleString("es-EC", {
    timeZone: "America/Guayaquil",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ReversarClient({ ops }: { ops: Operacion[] }) {
  const [target, setTarget] = useState<Operacion | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Reversar"
        subtitle="Anula una venta, compra, gasto o caja registrada por error o devuelta. Lo puede hacer cualquiera del turno con su PIN."
      />

      <div className="flex flex-col gap-2">
        {ops.length === 0 && (
          <p className="px-4 py-6 text-center text-sm opacity-50">
            No hay operaciones de los últimos 7 días.
          </p>
        )}
        {ops.map((op) => (
          <div
            key={op.op_id}
            className={`rounded-3xl border border-ink/10 p-4 ${op.anulada ? "opacity-50" : ""}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      TONE[op.event_code] ?? "bg-ink/10"
                    }`}
                  >
                    {op.event_label}
                  </span>
                  {op.source === "ia" && (
                    <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[11px] opacity-60">
                      IA
                    </span>
                  )}
                  {op.anulada && (
                    <span className="rounded-full bg-coral/15 px-2 py-0.5 text-[11px] font-semibold text-coral">
                      Anulada
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm font-medium">{op.description}</p>
                <p className="text-xs opacity-50">
                  {op.actor_name ?? "—"} · {horaLocal(op.created_at)}
                </p>
              </div>
              {!op.anulada && (
                <button
                  onClick={() => setTarget(op)}
                  className="shrink-0 rounded-full bg-coral/10 px-4 py-2 text-sm font-semibold text-coral"
                >
                  Anular
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="text-center text-xs opacity-50">
        Anular revierte la plata y el stock de esa operación. Queda el rastro en la bitácora.
      </p>

      {target && <AnularModal op={target} onClose={() => setTarget(null)} />}
    </div>
  );
}

function AnularModal({ op, onClose }: { op: Operacion; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    setMsg(null);
    if (!reason.trim()) return setMsg("El motivo es obligatorio.");
    if (pin.length < 4) return setMsg("Ingresa tu PIN.");
    start(async () => {
      const r = await anularOperacion({ opId: op.op_id, reason: reason.trim(), pin });
      if (r.error) setMsg(r.error);
      else onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-3xl bg-white p-5">
        <p className="text-lg font-bold">Anular operación</p>
        <p className="mb-3 text-sm opacity-70">{op.description}</p>
        <div className="flex flex-col gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputCls}
            placeholder="Motivo (ej. devolución / registro por error)"
          />
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className={inputCls}
            placeholder="Tu PIN"
          />
          <div className="mt-1 flex gap-2">
            <button
              onClick={submit}
              disabled={pending}
              className="flex-1 rounded-full bg-coral py-3 font-semibold text-white"
            >
              {pending ? "Anulando…" : "Sí, anular"}
            </button>
            <button
              onClick={onClose}
              className="rounded-full border border-ink/15 px-5 py-3 font-semibold"
            >
              Cancelar
            </button>
          </div>
          {msg && <p className="text-center text-sm text-coral">{msg}</p>}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Button, Card, Field, Input } from "@/components/ui";
import { crearCosto, eliminarCosto } from "../admin/actions";

interface Costo {
  id: string;
  name: string;
  amount: number;
  category: string;
  scheduleType: string;
}

const selectCls =
  "w-full rounded-2xl border border-ink/15 bg-white px-4 py-3 text-base outline-none focus:border-ink/40";
const FREQ: Record<string, string> = { monthly: "mensual", weekly: "semanal", daily: "diario" };
const CAT: Record<string, string> = {
  operativo: "operativo",
  administrativo: "administrativo",
  financiero: "financiero",
};

export default function CostosClient({ costs }: { costs: Costo[] }) {
  const [showAdd, setShowAdd] = useState(false);
  const [, start] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm opacity-60">Lo que se paga cada mes/semana (arriendo, sueldos…)</p>
        <button
          onClick={() => setShowAdd(true)}
          className="shrink-0 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white"
        >
          + Agregar
        </button>
      </div>

      {costs.length === 0 && (
        <p className="rounded-2xl bg-ink/[0.03] px-4 py-8 text-center text-sm opacity-60">
          Aún no hay costos fijos. Toca «+ Agregar».
        </p>
      )}

      {costs.map((c) => (
        <Card key={c.id}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-semibold">{c.name}</p>
              <p className="text-xs opacity-60">
                ${c.amount.toFixed(2)} · {FREQ[c.scheduleType] ?? c.scheduleType} ·{" "}
                {CAT[c.category] ?? c.category}
              </p>
            </div>
            <button
              onClick={() => {
                if (window.confirm(`¿Quitar ${c.name}?`)) start(() => void eliminarCosto(c.id));
              }}
              className="shrink-0 rounded-full bg-coral/10 px-4 py-2 text-sm font-semibold text-coral"
            >
              Quitar
            </button>
          </div>
        </Card>
      ))}

      {showAdd && <AddCostoModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}

function AddCostoModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("operativo");
  const [scheduleType, setScheduleType] = useState("monthly");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const crear = () => {
    setMsg(null);
    const amt = Number(amount);
    if (!name.trim() || !amt) return setMsg("Completa nombre y monto.");
    start(async () => {
      const r = await crearCosto({ name: name.trim(), amount: amt, category, scheduleType });
      if (r.error) setMsg(r.error);
      else onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-3xl bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-lg font-bold">Nuevo costo fijo</p>
          <button onClick={onClose} className="text-sm font-semibold opacity-50">
            Cerrar
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <Field label="Nombre">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Arriendo, Internet, Sueldo…" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Monto">
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" />
            </Field>
            <Field label="Frecuencia">
              <select className={selectCls} value={scheduleType} onChange={(e) => setScheduleType(e.target.value)}>
                <option value="monthly">Mensual</option>
                <option value="weekly">Semanal</option>
                <option value="daily">Diario</option>
              </select>
            </Field>
          </div>
          <Field label="Tipo">
            <select className={selectCls} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="operativo">Operativo (sueldos, servicios)</option>
              <option value="administrativo">Administrativo (arriendo, internet)</option>
              <option value="financiero">Financiero (préstamos)</option>
            </select>
          </Field>
          <Button onClick={crear} disabled={pending}>
            {pending ? "Guardando…" : "Agregar costo"}
          </Button>
          {msg && <p className="text-center text-sm text-coral">{msg}</p>}
        </div>
      </div>
    </div>
  );
}

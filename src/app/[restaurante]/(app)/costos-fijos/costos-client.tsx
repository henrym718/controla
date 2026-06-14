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

export default function CostosClient({ costs }: { costs: Costo[] }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("operativo");
  const [scheduleType, setScheduleType] = useState("monthly");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const crear = () => {
    setMsg(null);
    const amt = Number(amount);
    if (!name.trim() || !amt) {
      setMsg("Completa nombre y monto.");
      return;
    }
    start(async () => {
      const r = await crearCosto({ name: name.trim(), amount: amt, category, scheduleType });
      setMsg(r.error ?? "Costo agregado.");
      if (!r.error) {
        setName("");
        setAmount("");
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-3 bg-lav">
        <p className="font-semibold">Nuevo costo fijo</p>
        <Field label="Nombre">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Arriendo, Internet, Sueldo…"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Monto">
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
            />
          </Field>
          <Field label="Frecuencia">
            <select
              className={selectCls}
              value={scheduleType}
              onChange={(e) => setScheduleType(e.target.value)}
            >
              <option value="monthly">Mensual</option>
              <option value="weekly">Semanal</option>
              <option value="daily">Diario</option>
            </select>
          </Field>
        </div>
        <Field label="Tipo">
          <select
            className={selectCls}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="operativo">Operativo (sueldos, servicios)</option>
            <option value="administrativo">Administrativo (arriendo, internet)</option>
            <option value="financiero">Financiero (préstamos)</option>
          </select>
        </Field>
        <Button onClick={crear} disabled={pending}>
          {pending ? "Guardando…" : "Agregar costo"}
        </Button>
        {msg && <p className="text-center text-sm opacity-70">{msg}</p>}
      </Card>

      <div className="flex flex-col gap-2">
        {costs.map((c) => (
          <Card key={c.id}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">{c.name}</p>
                <p className="text-xs opacity-60">
                  ${c.amount.toFixed(2)} · {c.scheduleType} · {c.category}
                </p>
              </div>
              <button
                onClick={() => start(() => void eliminarCosto(c.id))}
                className="rounded-full bg-coral/10 px-4 py-2 text-sm font-semibold text-coral"
              >
                Quitar
              </button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

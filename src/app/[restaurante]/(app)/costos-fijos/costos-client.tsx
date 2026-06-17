"use client";

import { useState, useTransition } from "react";
import { Button, Card, Field, Input } from "@/components/ui";
import { crearCosto, editarCosto, eliminarCosto } from "../admin/actions";

interface Costo {
  id: string;
  name: string;
  amount: number;
  category: string;
  scheduleType: string;
  weekdays: number[];
  effectiveFrom: string;
}

const selectCls =
  "w-full rounded-2xl border border-ink/15 bg-white px-4 py-3 text-base outline-none focus:border-ink/40";
const FREQ: Record<string, string> = { monthly: "mensual", weekly: "semanal", daily: "diario" };
const CAT: Record<string, string> = {
  operativo: "operativo",
  administrativo: "administrativo",
  financiero: "financiero",
};
const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// Días en orden L M M J V S D, con su valor 0=domingo … 6=sábado.
const DIAS: { label: string; value: number }[] = [
  { label: "L", value: 1 },
  { label: "M", value: 2 },
  { label: "M", value: 3 },
  { label: "J", value: 4 },
  { label: "V", value: 5 },
  { label: "S", value: 6 },
  { label: "D", value: 0 },
];
const DIAS_LARGO = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function fmtDesde(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return `${d} ${MES_CORTO[m - 1]} ${y}`;
}

function fmtDias(wds: number[]): string {
  if (!wds.length) return "toda la semana";
  // Orden visual L→D
  const ordered = DIAS.filter((d) => wds.includes(d.value)).map((d) => DIAS_LARGO[d.value]);
  return ordered.join(", ");
}

export default function CostosClient({ costs, hoy }: { costs: Costo[]; hoy: string }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Costo | null>(null);
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
              {c.scheduleType === "weekly" && (
                <p className="text-xs opacity-40">Se reparte: {fmtDias(c.weekdays)}</p>
              )}
              <p className="text-xs opacity-40">Vigente desde {fmtDesde(c.effectiveFrom)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => setEditing(c)}
                className="rounded-full bg-ink/[0.06] px-4 py-2 text-sm font-semibold text-ink"
              >
                Editar
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`¿Quitar ${c.name}?`)) start(() => void eliminarCosto(c.id));
                }}
                className="rounded-full bg-coral/10 px-4 py-2 text-sm font-semibold text-coral"
              >
                Quitar
              </button>
            </div>
          </div>
        </Card>
      ))}

      {showAdd && <CostoModal hoy={hoy} onClose={() => setShowAdd(false)} />}
      {editing && <CostoModal hoy={hoy} costo={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function WeekdayPicker({
  value,
  onChange,
}: {
  value: number[];
  onChange: (next: number[]) => void;
}) {
  const toggle = (d: number) =>
    onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d]);
  return (
    <div>
      <span className="mb-1 block text-sm font-medium">Días en que se paga</span>
      <div className="flex gap-1.5">
        {DIAS.map((d, i) => {
          const on = value.includes(d.value);
          return (
            <button
              key={i}
              type="button"
              onClick={() => toggle(d.value)}
              className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold transition active:scale-95 ${
                on ? "bg-ink text-white" : "border border-ink/15 text-ink/60"
              }`}
            >
              {d.label}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-xs opacity-50">
        {value.length
          ? `El monto se reparte solo entre estos ${value.length} día(s).`
          : "Sin elegir días, se reparte en los 7 días de la semana."}
      </p>
    </div>
  );
}

function CostoModal({
  hoy,
  costo,
  onClose,
}: {
  hoy: string;
  costo?: Costo;
  onClose: () => void;
}) {
  const editMode = !!costo;
  const [name, setName] = useState(costo?.name ?? "");
  const [amount, setAmount] = useState(costo ? String(costo.amount) : "");
  const [category, setCategory] = useState(costo?.category ?? "operativo");
  const [scheduleType, setScheduleType] = useState(costo?.scheduleType ?? "monthly");
  const [weekdays, setWeekdays] = useState<number[]>(costo?.weekdays ?? []);
  const [effectiveFrom, setEffectiveFrom] = useState(costo?.effectiveFrom ?? hoy);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const guardar = () => {
    setMsg(null);
    const amt = Number(amount);
    if (!name.trim() || !amt) return setMsg("Completa nombre y monto.");
    start(async () => {
      const r = editMode
        ? await editarCosto({
            id: costo!.id,
            name: name.trim(),
            amount: amt,
            category,
            scheduleType,
            weekdays,
            effectiveFrom,
          })
        : await crearCosto({
            name: name.trim(),
            amount: amt,
            category,
            scheduleType,
            weekdays,
            effectiveFrom,
          });
      if (r.error) setMsg(r.error);
      else onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-3xl bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-lg font-bold">{editMode ? "Editar costo fijo" : "Nuevo costo fijo"}</p>
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
          {scheduleType === "weekly" && <WeekdayPicker value={weekdays} onChange={setWeekdays} />}
          <Field label="Tipo">
            <select className={selectCls} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="operativo">Operativo (sueldos, servicios)</option>
              <option value="administrativo">Administrativo (arriendo, internet)</option>
              <option value="financiero">Financiero (préstamos)</option>
            </select>
          </Field>
          <Field label="Vigente desde">
            <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} max={hoy} />
          </Field>
          <p className="-mt-1 text-xs opacity-50">
            Desde cuándo cuenta este costo. Si tu negocio ya operaba antes, elige una fecha anterior.
          </p>
          <Button onClick={guardar} disabled={pending}>
            {pending ? "Guardando…" : editMode ? "Guardar cambios" : "Agregar costo"}
          </Button>
          {msg && <p className="text-center text-sm text-coral">{msg}</p>}
        </div>
      </div>
    </div>
  );
}

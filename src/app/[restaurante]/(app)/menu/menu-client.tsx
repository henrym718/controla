"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { PageTitle } from "@/components/ui";
import { parseLocal, eachDate } from "@/lib/range";
import {
  agregarAlMenu,
  agregarVariosAlMenu,
  quitarDelMenu,
  toggleAgotado,
  copiarMenu,
} from "./actions";

interface DishRow {
  id: string;
  name: string;
  catalogPrice: number;
  inMenu: boolean;
  price: number;
  available: boolean;
  kind: "plato" | "combo" | "extra";
}

const KIND_TAG: Record<DishRow["kind"], { label: string; cls: string } | null> = {
  plato: null,
  combo: { label: "combo", cls: "bg-mint" },
  extra: { label: "adicional", cls: "bg-peach" },
};
interface ShiftOpt {
  id: string;
  name: string;
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const WD = ["D", "L", "M", "M", "J", "V", "S"];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dateLabel(date: string, today: string): string {
  if (date === today) return "Hoy";
  const d = parseLocal(date);
  return `${d.getDate()} de ${MESES[d.getMonth()]}`;
}

const inputCls =
  "rounded-xl border border-ink/15 px-2 py-1.5 text-sm outline-none focus:border-ink/40";

export default function MenuClient({
  isAdmin,
  today,
  date,
  shiftId,
  shiftName,
  shifts,
  dishes,
}: {
  isAdmin: boolean;
  today: string;
  date: string;
  shiftId: string;
  shiftName: string;
  shifts: ShiftOpt[];
  dishes: DishRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [showCopy, setShowCopy] = useState(false);
  const [bulkPending, startBulk] = useTransition();

  const addAll = (items: DishRow[]) => {
    const payload = items.map((d) => ({ dishId: d.id, price: d.price || d.catalogPrice }));
    if (payload.length === 0) return;
    startBulk(async () => {
      await agregarVariosAlMenu({ items: payload, date, shiftId });
      router.refresh();
    });
  };

  const go = (d: string, s: string) =>
    router.push(`${pathname}?date=${d}&shift=${s}`);
  const stepDay = (delta: number) => {
    const d = parseLocal(date);
    d.setDate(d.getDate() + delta);
    go(ymd(d), shiftId);
  };

  const enMenu = dishes.filter((d) => d.inMenu);
  const fuera = dishes.filter((d) => !d.inMenu);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Menú" />

      {isAdmin ? (
        <>
          <div className="flex flex-wrap gap-2">
            {shifts.map((s) => (
              <button
                key={s.id}
                onClick={() => go(date, s.id)}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                  s.id === shiftId ? "bg-ink text-white" : "border border-ink/15"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
          <DateStepper
            date={date}
            today={today}
            onStep={stepDay}
            onPick={(d) => go(d, shiftId)}
          />
        </>
      ) : (
        <p className="text-sm font-semibold">Menú de hoy · {shiftName}</p>
      )}

      <p className="text-sm opacity-60">
        Elige qué platos se venden {isAdmin ? "ese día en ese turno" : "hoy en este turno"} y
        confirma su precio. La IA usa estos precios al registrar ventas.
      </p>

      {isAdmin && enMenu.length > 0 && (
        <button
          onClick={() => setShowCopy((v) => !v)}
          className="self-start rounded-full border border-ink/15 px-4 py-1.5 text-sm font-semibold"
        >
          {showCopy ? "Cerrar" : "Programar: copiar este menú a otros días"}
        </button>
      )}
      {showCopy && (
        <CopyPanel
          date={date}
          shiftId={shiftId}
          shiftName={shiftName}
          shifts={shifts}
          onDone={() => {
            setShowCopy(false);
            router.refresh();
          }}
        />
      )}

      {enMenu.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-50">En el menú</p>
          {enMenu.map((d) => (
            <Row key={d.id} dish={d} date={date} shiftId={shiftId} />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {(
          [
            { label: "Platos", items: fuera.filter((d) => d.kind === "plato") },
            { label: "Combos", items: fuera.filter((d) => d.kind === "combo") },
            { label: "Adicionales", items: fuera.filter((d) => d.kind === "extra") },
          ] as const
        ).map((g) =>
          g.items.length === 0 ? null : (
            <div key={g.label} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide opacity-50">
                  Agregar — {g.label}
                </p>
                {g.items.length > 1 && (
                  <button
                    onClick={() => addAll(g.items)}
                    disabled={bulkPending}
                    className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {bulkPending ? "Agregando…" : "Agregar todos"}
                  </button>
                )}
              </div>
              {g.items.map((d) => (
                <Row key={d.id} dish={d} date={date} shiftId={shiftId} />
              ))}
            </div>
          ),
        )}
        {fuera.length === 0 && (
          <p className="text-sm opacity-50">Todo el catálogo ya está en el menú.</p>
        )}
      </div>
    </div>
  );
}

function DateStepper({
  date,
  today,
  onStep,
  onPick,
}: {
  date: string;
  today: string;
  onStep: (delta: number) => void;
  onPick: (date: string) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-2">
      <button
        onClick={() => onStep(-1)}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-ink/5 text-xl font-bold"
      >
        ‹
      </button>
      <div className="min-w-32 text-center">
        <p className="text-base font-bold leading-tight">{dateLabel(date, today)}</p>
        {date !== today && <p className="text-xs opacity-50">{date}</p>}
      </div>
      <button
        onClick={() => onStep(1)}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-ink/5 text-xl font-bold"
      >
        ›
      </button>
      <input
        type="date"
        value={date}
        onChange={(e) => e.target.value && onPick(e.target.value)}
        className={inputCls}
      />
    </div>
  );
}

function Row({
  dish,
  date,
  shiftId,
}: {
  dish: DishRow;
  date: string;
  shiftId: string;
}) {
  const router = useRouter();
  const [price, setPrice] = useState(String(dish.price));
  const [pending, start] = useTransition();
  const p = Number(price) || 0;

  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      router.refresh();
    });

  return (
    <div
      className={`flex items-center gap-2 rounded-2xl border px-3 py-2 ${
        dish.inMenu && !dish.available ? "border-ink/10 bg-ink/[0.03] opacity-60" : "border-ink/10"
      }`}
    >
      <span className="flex flex-1 items-center gap-1.5 text-sm font-medium">
        {dish.name}
        {KIND_TAG[dish.kind] && (
          <span
            className={`rounded-full ${KIND_TAG[dish.kind]!.cls} px-2 py-0.5 text-[10px] font-semibold`}
          >
            {KIND_TAG[dish.kind]!.label}
          </span>
        )}
      </span>
      <span className="text-sm opacity-40">$</span>
      <input
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        inputMode="decimal"
        className={`w-20 ${inputCls}`}
      />
      {dish.inMenu ? (
        <>
          <button
            onClick={() => run(() => agregarAlMenu({ dishId: dish.id, price: p, date, shiftId }))}
            disabled={pending}
            className="rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white"
          >
            Guardar
          </button>
          <button
            onClick={() =>
              run(() => toggleAgotado({ dishId: dish.id, available: !dish.available, date, shiftId }))
            }
            disabled={pending}
            className="rounded-full border border-ink/15 px-3 py-1.5 text-xs font-semibold"
          >
            {dish.available ? "Agotado" : "Disponible"}
          </button>
          <button
            onClick={() => run(() => quitarDelMenu({ dishId: dish.id, date, shiftId }))}
            disabled={pending}
            className="rounded-full border border-coral/40 px-3 py-1.5 text-xs font-semibold text-coral"
          >
            Quitar
          </button>
        </>
      ) : (
        <button
          onClick={() => run(() => agregarAlMenu({ dishId: dish.id, price: p, date, shiftId }))}
          disabled={pending}
          className="rounded-full bg-ink px-4 py-1.5 text-xs font-semibold text-white"
        >
          Agregar
        </button>
      )}
    </div>
  );
}

function CopyPanel({
  date,
  shiftId,
  shiftName,
  shifts,
  onDone,
}: {
  date: string;
  shiftId: string;
  shiftName: string;
  shifts: ShiftOpt[];
  onDone: () => void;
}) {
  const [from, setFrom] = useState(date);
  const [to, setTo] = useState(date);
  const [targetShift, setTargetShift] = useState(shiftId);
  const [wds, setWds] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggleWd = (w: number) =>
    setWds((prev) => (prev.includes(w) ? prev.filter((x) => x !== w) : [...prev, w]));

  const submit = () => {
    setMsg(null);
    const dates = eachDate(from, to)
      .filter((d) => wds.includes(d.getDay()))
      .map(ymd);
    if (dates.length === 0)
      return setMsg("Ese rango no tiene días seleccionados (revisa fechas y días).");
    start(async () => {
      const r = await copiarMenu({
        srcDate: date,
        srcShiftId: shiftId,
        targetShiftId: targetShift,
        dates,
      });
      if (r.error) setMsg(r.error);
      else {
        setMsg(`✅ Copiado a ${r.count} día(s).`);
        setTimeout(onDone, 600);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-ink/10 bg-ink/[0.02] p-4">
      <p className="text-sm font-semibold">
        Copiar el menú de “{date} · {shiftName}” a:
      </p>
      <div className="flex items-center gap-2 text-sm">
        <span className="opacity-60">Desde</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        <span className="opacity-60">hasta</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
      </div>
      <div className="flex items-center gap-1">
        {WD.map((l, w) => (
          <button
            key={w}
            onClick={() => toggleWd(w)}
            className={`h-8 w-8 rounded-full text-xs font-semibold ${
              wds.includes(w) ? "bg-ink text-white" : "border border-ink/15"
            }`}
          >
            {l}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <span className="opacity-60">Turno destino</span>
        <select
          value={targetShift}
          onChange={(e) => setTargetShift(e.target.value)}
          className={inputCls}
        >
          {shifts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={pending}
          className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-white"
        >
          {pending ? "Copiando…" : "Copiar"}
        </button>
        {msg && <span className="text-sm">{msg}</span>}
      </div>
    </div>
  );
}

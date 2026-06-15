"use client";

import { useMemo, useState, useTransition } from "react";
import { DayNav } from "@/components/day-nav";
import { Button, Card } from "@/components/ui";
import { registrarConteoAction } from "../admin/actions";

export interface ConteoItem {
  ingredient_id: string;
  name: string;
  unit: string | null;
  expected: number;
  counted: number | null;
  diff: number | null;
  unit_cost: number;
  diff_cost: number | null;
  tag: string | null;
}
export interface ConteoEstado {
  date: string;
  locked: boolean;
  items: ConteoItem[];
}

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
const qty = (n: number | null) => (n == null ? "—" : String(Number(n)));

export default function ConteoClient({
  today,
  initial,
}: {
  today: string;
  initial: ConteoEstado;
}) {
  const [date, setDate] = useState(today);
  const [data, setData] = useState<ConteoEstado>(initial);
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const editable = !data.locked && date === today;

  async function load(d: string) {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/conteo?date=${d}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  function change(d: string) {
    setDate(d);
    setCounts({});
    void load(d);
  }

  // Faltante en vivo (mientras se cuenta) o registrado (día cerrado)
  const faltante = useMemo(() => {
    if (data.locked) {
      return data.items.reduce(
        (s, i) => s + (i.diff != null && i.diff < 0 ? Math.abs(Number(i.diff_cost)) : 0),
        0,
      );
    }
    return data.items.reduce((s, i) => {
      const raw = counts[i.ingredient_id];
      if (raw === undefined || raw === "") return s;
      const d = (Number(raw) || 0) - Number(i.expected);
      return s + (d < 0 ? Math.abs(d) * Number(i.unit_cost) : 0);
    }, 0);
  }, [data, counts]);

  function submit() {
    setMsg(null);
    const payload = data.items.map((i) => {
      const raw = counts[i.ingredient_id];
      // en blanco = "cuadra" (cuenta igual a lo esperado)
      const countedQty = raw === undefined || raw === "" ? Number(i.expected) : Number(raw) || 0;
      return { ingredientId: i.ingredient_id, countedQty };
    });
    start(async () => {
      const r = await registrarConteoAction(date, payload);
      if (r.error) setMsg(r.error);
      else await load(date);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Conteo de cierre</h1>
        <p className="text-sm opacity-60">
          Auditoría anti-robo opcional — no toca el costo de los platos. Cuentas el stock físico
          (bebidas, carnes, presas…); si falta, es plata perdida.
        </p>
      </div>
      <DayNav value={date} today={today} onChange={change} />

      {/* Faltante (la señal anti-robo) */}
      <div className={`rounded-3xl p-5 text-white ${faltante > 0.005 ? "bg-coral" : "bg-ink"}`}>
        <p className="text-xs font-medium text-white/70">
          {data.locked ? "Faltante registrado (posible robo)" : "Faltante en curso"}
        </p>
        <p className="text-3xl font-bold">{money(faltante)}</p>
        <p className="text-xs text-white/60">
          Plata en producto que falta vs lo que el sistema esperaba.
        </p>
      </div>

      <div className={loading ? "pointer-events-none opacity-50 transition" : "transition"}>
        {data.items.length === 0 ? (
          <p className="rounded-2xl bg-ink/[0.03] px-3 py-6 text-center text-sm opacity-60">
            No hay productos contables que contar.
          </p>
        ) : editable ? (
          <ContarForm items={data.items} counts={counts} setCounts={setCounts} />
        ) : data.locked ? (
          <ResultadoTabla items={data.items} />
        ) : (
          <p className="rounded-2xl bg-ink/[0.03] px-3 py-6 text-center text-sm opacity-60">
            No se registró conteo este día. El conteo se hace el mismo día del cierre.
          </p>
        )}
      </div>

      {editable && data.items.length > 0 && (
        <>
          <Button variant="accent" onClick={submit} disabled={pending}>
            {pending ? "Guardando…" : "Guardar conteo de cierre"}
          </Button>
          <p className="text-center text-xs opacity-50">
            Lo que dejes en blanco se toma como “cuadra” (igual a lo esperado).
          </p>
        </>
      )}
      {msg && <p className="text-center text-sm text-coral">{msg}</p>}
    </div>
  );
}

function ContarForm({
  items,
  counts,
  setCounts,
}: {
  items: ConteoItem[];
  counts: Record<string, string>;
  setCounts: (f: (c: Record<string, string>) => Record<string, string>) => void;
}) {
  return (
    <Card className="p-0">
      <div className="flex bg-ink/5 px-4 py-2 text-xs font-semibold opacity-60">
        <span className="flex-1">Producto</span>
        <span className="w-20 text-right">Debería</span>
        <span className="w-24 text-right">Contado</span>
      </div>
      {items.map((i) => {
        const raw = counts[i.ingredient_id] ?? "";
        const diff = raw === "" ? null : (Number(raw) || 0) - Number(i.expected);
        return (
          <div key={i.ingredient_id} className="flex items-center border-t border-ink/5 px-4 py-2 text-sm">
            <span className="flex-1 font-medium">
              {i.name}
              {i.unit && <span className="ml-1 text-[11px] opacity-40">{i.unit}</span>}
              {diff != null && diff !== 0 && (
                <span className={`ml-2 text-[11px] font-semibold ${diff < 0 ? "text-coral" : "text-teal"}`}>
                  {diff > 0 ? `+${diff}` : diff}
                </span>
              )}
            </span>
            <span className="w-20 text-right opacity-60">{qty(i.expected)}</span>
            <input
              inputMode="decimal"
              value={raw}
              onChange={(e) =>
                setCounts((c) => ({ ...c, [i.ingredient_id]: e.target.value }))
              }
              placeholder={qty(i.expected)}
              className="ml-2 w-20 rounded-xl border border-ink/15 px-2 py-1.5 text-right text-sm outline-none focus:border-ink/40"
            />
          </div>
        );
      })}
    </Card>
  );
}

function ResultadoTabla({ items }: { items: ConteoItem[] }) {
  return (
    <Card className="p-0">
      <div className="flex bg-ink/5 px-4 py-2 text-xs font-semibold opacity-60">
        <span className="flex-1">Producto</span>
        <span className="w-16 text-right">Esper.</span>
        <span className="w-16 text-right">Contó</span>
        <span className="w-20 text-right">Desfase</span>
      </div>
      {items.map((i) => {
        const d = Number(i.diff ?? 0);
        const cuadra = Math.abs(d) < 0.0001;
        return (
          <div key={i.ingredient_id} className="flex items-center border-t border-ink/5 px-4 py-2 text-sm">
            <span className="flex-1 font-medium">{i.name}</span>
            <span className="w-16 text-right opacity-60">{qty(i.expected)}</span>
            <span className="w-16 text-right">{qty(i.counted)}</span>
            <span className={`w-20 text-right font-semibold ${cuadra ? "opacity-40" : d < 0 ? "text-coral" : "text-teal"}`}>
              {cuadra ? "—" : `${d > 0 ? "+" : ""}${d} · ${money(Number(i.diff_cost))}`}
            </span>
          </div>
        );
      })}
    </Card>
  );
}

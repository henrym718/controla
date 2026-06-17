"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { PageTitle } from "@/components/ui";
import { parseLocal, eachDate } from "@/lib/range";
import {
  agregarAlMenu,
  agregarVariosAlMenu,
  quitarDelMenu,
  toggleAgotado,
  copiarMenu,
} from "../actions";

interface DishRow {
  id: string;
  name: string;
  catalogPrice: number;
  inMenu: boolean;
  price: number;
  available: boolean;
  kind: "plato" | "combo";
}

const KIND_TAG: Record<DishRow["kind"], { label: string; cls: string } | null> = {
  plato: null,
  combo: { label: "combo", cls: "bg-mint" },
};

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
const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export default function MenuClient({
  isAdmin,
  today,
  date,
  dishes,
}: {
  isAdmin: boolean;
  today: string;
  date: string;
  dishes: DishRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const boardPath = pathname.replace(/\/editar$/, ""); // .../menu
  const [showCopy, setShowCopy] = useState(false);
  const [bulkPending, startBulk] = useTransition();
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<DishRow["kind"], boolean>>({
    plato: false,
    combo: false,
  });

  const addAll = (items: DishRow[]) => {
    const payload = items.map((d) => ({ dishId: d.id, price: d.catalogPrice }));
    if (payload.length === 0) return;
    startBulk(async () => {
      await agregarVariosAlMenu({ items: payload, date });
      router.refresh();
    });
  };

  const go = (d: string) => router.push(`${pathname}?date=${d}`);
  const stepDay = (delta: number) => {
    const d = parseLocal(date);
    d.setDate(d.getDate() + delta);
    go(ymd(d));
  };

  const enMenu = dishes.filter((d) => d.inMenu);
  const fuera = dishes.filter((d) => !d.inMenu);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <PageTitle title="Editar menú" />
        <Link
          href={`${boardPath}?date=${date}`}
          className="shrink-0 rounded-full border border-ink/15 px-4 py-1.5 text-sm font-semibold"
        >
          Ver menú
        </Link>
      </div>

      {isAdmin && (
        <DateStepper date={date} today={today} onStep={stepDay} />
      )}

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
            <Row key={d.id} dish={d} date={date} />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide opacity-50">
          Opciones de menú
        </p>

        {fuera.length === 0 ? (
          <p className="text-sm opacity-50">Todo el catálogo ya está en el menú.</p>
        ) : (
          <>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-40">
                🔍
              </span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar plato o combo disponible…"
                className="w-full rounded-2xl border border-ink/15 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-ink/40"
              />
            </div>

            {(
              [
                { kind: "plato", label: "Agregar platos" },
                { kind: "combo", label: "Agregar combos" },
              ] as const
            ).map((g) => {
              const groupItems = fuera.filter((d) => d.kind === g.kind);
              if (groupItems.length === 0) return null;
              const q = norm(query.trim());
              const items =
                q === "" ? groupItems : groupItems.filter((d) => norm(d.name).includes(q));
              const expanded = q !== "" || openGroups[g.kind];

              return (
                <div key={g.kind} className="overflow-hidden rounded-2xl border border-ink/10">
                  <button
                    onClick={() =>
                      setOpenGroups((p) => ({ ...p, [g.kind]: !p[g.kind] }))
                    }
                    className="flex w-full items-center justify-between gap-2 bg-ink/[0.03] px-4 py-3 text-left"
                  >
                    <span className="text-sm font-semibold">
                      {g.label}
                      <span className="ml-2 text-xs font-normal opacity-50">
                        {q !== ""
                          ? `${items.length} resultado${items.length === 1 ? "" : "s"}`
                          : `${groupItems.length} disponible${groupItems.length === 1 ? "" : "s"}`}
                      </span>
                    </span>
                    <span
                      className={`text-base transition-transform ${expanded ? "rotate-180" : ""}`}
                    >
                      ⌄
                    </span>
                  </button>

                  {expanded && (
                    <div className="flex flex-col gap-2 border-t border-ink/10 p-3">
                      {items.length > 1 && (
                        <button
                          onClick={() => addAll(items)}
                          disabled={bulkPending}
                          className="self-end rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {bulkPending ? "Agregando…" : `Agregar todos (${items.length})`}
                        </button>
                      )}
                      {items.length === 0 ? (
                        <p className="px-1 py-2 text-sm opacity-50">Sin resultados.</p>
                      ) : (
                        <div className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
                          {items.map((d) => (
                            <Row key={d.id} dish={d} date={date} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function DateStepper({
  date,
  today,
  onStep,
}: {
  date: string;
  today: string;
  onStep: (delta: number) => void;
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
    </div>
  );
}

function Row({ dish, date }: { dish: DishRow; date: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      router.refresh();
    });

  return (
    <div
      className={`flex items-center gap-2 rounded-2xl border px-3 py-2.5 ${
        dish.inMenu && !dish.available
          ? "border-ink/10 bg-ink/[0.03] opacity-60"
          : "border-ink/10"
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
      <span className="text-sm font-semibold opacity-50">{money(dish.catalogPrice)}</span>
      {dish.inMenu ? (
        <>
          <button
            onClick={() =>
              run(() => toggleAgotado({ dishId: dish.id, available: !dish.available, date }))
            }
            disabled={pending}
            className="rounded-full border border-ink/15 px-3 py-1.5 text-xs font-semibold"
          >
            {dish.available ? "Agotado" : "Disponible"}
          </button>
          <button
            onClick={() => run(() => quitarDelMenu({ dishId: dish.id, date }))}
            disabled={pending}
            className="rounded-full border border-coral/40 px-3 py-1.5 text-xs font-semibold text-coral"
          >
            Quitar
          </button>
        </>
      ) : (
        <button
          onClick={() => run(() => agregarAlMenu({ dishId: dish.id, price: dish.catalogPrice, date }))}
          disabled={pending}
          className="rounded-full bg-ink px-4 py-1.5 text-xs font-semibold text-white"
        >
          Agregar
        </button>
      )}
    </div>
  );
}

function CopyPanel({ date, onDone }: { date: string; onDone: () => void }) {
  const [from, setFrom] = useState(date);
  const [to, setTo] = useState(date);
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
      const r = await copiarMenu({ srcDate: date, dates });
      if (r.error) setMsg(r.error);
      else {
        setMsg(`✅ Copiado a ${r.count} día(s).`);
        setTimeout(onDone, 600);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-ink/10 bg-ink/[0.02] p-4">
      <p className="text-sm font-semibold">Copiar el menú de “{date}” a:</p>
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

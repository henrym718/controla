"use client";

import { useState } from "react";

export interface LogRow {
  id: string;
  created_at: string;
  actor_name: string | null;
  source: string;
  event_code: string;
  event_label: string;
  category: string;
  description: string;
  metadata: unknown;
}

// Filtros por categoría (la tabla activity_events permite agruparlos así).
const CATS: { code: string; label: string }[] = [
  { code: "", label: "Todo" },
  { code: "acceso", label: "Acceso" },
  { code: "ventas", label: "Ventas" },
  { code: "caja", label: "Caja" },
  { code: "costos", label: "Costos" },
  { code: "inventario", label: "Inventario" },
  { code: "menu", label: "Menú" },
  { code: "cierre", label: "Cierres" },
  { code: "reversa", label: "Reversa" },
  { code: "config", label: "Configuración" },
];

const CAT_TONE: Record<string, string> = {
  acceso: "bg-lav",
  ventas: "bg-mint",
  caja: "bg-peach",
  costos: "bg-sand",
  inventario: "bg-mint",
  menu: "bg-lav",
  cierre: "bg-peach",
  reversa: "bg-coral/15",
  config: "bg-sand",
};

const TZ = "America/Guayaquil";
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const fmtDayKey = (iso: string) =>
  new Date(iso).toLocaleDateString("es-EC", { timeZone: TZ });
const fmtDayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("es-EC", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: TZ,
  });

function minus(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

const PRESETS = (today: string): { key: string; label: string; from: string; to: string }[] => [
  { key: "hoy", label: "Hoy", from: today, to: today },
  { key: "ayer", label: "Ayer", from: minus(today, 1), to: minus(today, 1) },
  { key: "7d", label: "7 días", from: minus(today, 6), to: today },
];

export default function BitacoraClient({
  today,
  initial,
}: {
  today: string;
  initial: LogRow[];
}) {
  const presets = PRESETS(today);
  const [preset, setPreset] = useState("7d");
  const [category, setCategory] = useState("");
  const [rows, setRows] = useState<LogRow[]>(initial);
  const [loading, setLoading] = useState(false);

  async function load(nextPreset: string, nextCat: string) {
    const p = presets.find((x) => x.key === nextPreset) ?? presets[2];
    setLoading(true);
    try {
      const qs = new URLSearchParams({ from: p.from, to: p.to });
      if (nextCat) qs.set("category", nextCat);
      const res = await fetch(`/api/bitacora?${qs.toString()}`);
      if (res.ok) setRows(await res.json());
    } finally {
      setLoading(false);
    }
  }

  function changePreset(k: string) {
    setPreset(k);
    load(k, category);
  }
  function changeCat(c: string) {
    setCategory(c);
    load(preset, c);
  }

  // Agrupar por día (ya viene ordenado de más reciente a más antiguo).
  const groups: { key: string; label: string; items: LogRow[] }[] = [];
  for (const r of rows) {
    const key = fmtDayKey(r.created_at);
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, label: fmtDayLabel(r.created_at), items: [] };
      groups.push(g);
    }
    g.items.push(r);
  }

  const pill = (active: boolean) =>
    `rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
      active ? "bg-ink text-white" : "bg-ink/5 text-ink"
    }`;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Bitácora</h1>
        <p className="mt-1 text-sm opacity-60">
          Quién hizo qué y cuándo. Se conservan los últimos 7 días.
        </p>
      </div>

      {/* Filtro de fecha */}
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <button key={p.key} onClick={() => changePreset(p.key)} className={pill(preset === p.key)}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Filtro por evento (categoría) */}
      <div className="-mx-5 overflow-x-auto px-5">
        <div className="flex w-max gap-2">
          {CATS.map((c) => (
            <button key={c.code} onClick={() => changeCat(c.code)} className={pill(category === c.code)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className={loading ? "pointer-events-none opacity-50 transition" : "transition"}>
        {groups.length === 0 && (
          <p className="rounded-2xl bg-ink/[0.03] px-3 py-10 text-center text-sm opacity-60">
            No hay actividad en este rango.
          </p>
        )}

        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <div key={g.key} className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide opacity-40">{g.label}</p>
              <div className="flex flex-col gap-2">
                {g.items.map((r) => (
                  <Entry key={r.id} r={r} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Entry({ r }: { r: LogRow }) {
  const tone = CAT_TONE[r.category] ?? "bg-ink/5";
  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}>
          {r.event_label}
        </span>
        <span className="shrink-0 text-xs font-medium tabular-nums opacity-50">
          {fmtTime(r.created_at)}
        </span>
      </div>
      <p className="mt-1.5 text-sm leading-snug">{r.description}</p>
      <p className="mt-1 text-[11px] opacity-50">
        {r.actor_name ?? "—"}
        <span className="mx-1 opacity-30">·</span>
        {r.source === "ia" ? "por voz (IA)" : r.source === "sistema" ? "sistema" : "manual"}
      </p>
    </div>
  );
}

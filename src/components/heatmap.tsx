"use client";

import { useState } from "react";

interface Cell {
  shiftId: string;
  ventas: number;
  costo: number;
  efic: number | null;
}
interface Row {
  weekday: number;
  label: string;
  cells: Cell[];
}

const money = (n: number) => `$${n.toFixed(0)}`;

export function Heatmap({
  rows,
  shiftCols,
}: {
  rows: Row[];
  shiftCols: { id: string; name: string }[];
}) {
  const [mode, setMode] = useState<"dinero" | "pct">("dinero");

  const pill = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-ink text-white" : "bg-ink/5"}`;

  return (
    <div>
      <div className="mb-3 flex justify-end gap-2">
        <button onClick={() => setMode("dinero")} className={pill(mode === "dinero")}>
          Dinero
        </button>
        <button onClick={() => setMode("pct")} className={pill(mode === "pct")}>
          % sueldo
        </button>
      </div>

      <div
        className="grid gap-1 text-center text-xs"
        style={{ gridTemplateColumns: `44px repeat(${shiftCols.length}, 1fr)` }}
      >
        <span />
        {shiftCols.map((s) => (
          <span key={s.id} className="pb-1 font-semibold">{s.name}</span>
        ))}

        {rows.map((row) => (
          <RowCells key={row.weekday} label={row.label}>
            {row.cells.map((c) => {
              const hasData = c.ventas > 0 || c.costo > 0;
              const rinde = c.ventas >= c.costo;
              const pct = c.ventas > 0 ? (c.costo / c.ventas) * 100 : null;

              let bg = "bg-ink/5";
              if (hasData) {
                if (mode === "dinero") bg = rinde && c.ventas > 0 ? "bg-teal/40" : "bg-coral/30";
                else if (pct == null) bg = "bg-coral/30";
                else if (pct <= 35) bg = "bg-teal/40";
                else if (pct <= 50) bg = "bg-sand";
                else bg = "bg-coral/30";
              }

              return (
                <div key={c.shiftId} className={`rounded-lg py-1.5 ${bg}`}>
                  {!hasData ? (
                    <span className="opacity-40">—</span>
                  ) : mode === "dinero" ? (
                    <>
                      <span className="block font-semibold leading-tight">{money(c.ventas)}</span>
                      <span className="block text-[10px] leading-tight opacity-60">
                        sueldo {money(c.costo)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="block font-semibold leading-tight">
                        {pct == null ? "—" : `${pct.toFixed(0)}%`}
                      </span>
                      <span className="block text-[10px] leading-tight opacity-60">{money(c.ventas)}</span>
                    </>
                  )}
                </div>
              );
            })}
          </RowCells>
        ))}
      </div>
    </div>
  );
}

function RowCells({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="flex items-center justify-end pr-1 font-semibold opacity-60">{label}</span>
      {children}
    </>
  );
}

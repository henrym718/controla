"use client";

import { useRef } from "react";
import { parseLocal } from "@/lib/range";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Navegador de día controlado: ‹ fecha › + ícono calendario. Sin URL. */
export function DayNav({
  value,
  today,
  onChange,
}: {
  value: string;
  today: string;
  onChange: (date: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const shift = (delta: number) => {
    const d = parseLocal(value);
    d.setDate(d.getDate() + delta);
    onChange(ymd(d));
  };

  const isToday = value === today;
  const d = parseLocal(value);
  const label = isToday ? "Hoy" : `${d.getDate()} de ${MESES[d.getMonth()]}`;

  return (
    <div className="flex items-center justify-center gap-2">
      <button
        onClick={() => shift(-1)}
        aria-label="Día anterior"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-ink/5 text-xl font-bold"
      >
        ‹
      </button>

      <div className="min-w-32 text-center">
        <p className="text-base font-bold leading-tight">{label}</p>
        {!isToday && <p className="text-xs opacity-50">{value}</p>}
      </div>

      <button
        onClick={() => shift(1)}
        disabled={isToday}
        aria-label="Día siguiente"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-ink/5 text-xl font-bold disabled:opacity-30"
      >
        ›
      </button>

      <button
        onClick={() => {
          const el = inputRef.current;
          if (el?.showPicker) el.showPicker();
          else el?.click();
        }}
        aria-label="Elegir fecha"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-ink/5"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="3" />
          <path d="M3 9h18M8 2v4M16 2v4" />
        </svg>
      </button>

      <input
        ref={inputRef}
        type="date"
        max={today}
        value={value}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="sr-only"
      />
    </div>
  );
}

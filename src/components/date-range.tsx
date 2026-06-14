"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

const PRESETS: [string, string][] = [
  ["hoy", "Hoy"],
  ["ayer", "Ayer"],
  ["7d", "7 días"],
  ["30d", "30 días"],
  ["mes", "Mes"],
];

export function DateRangePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const current = sp.get("preset") ?? "7d";

  const [from, setFrom] = useState(sp.get("from") ?? "");
  const [to, setTo] = useState(sp.get("to") ?? "");
  const [showCustom, setShowCustom] = useState(current === "custom");

  const go = (preset: string) => router.push(`${pathname}?preset=${preset}`);
  const goCustom = () => {
    if (from && to) router.push(`${pathname}?preset=custom&from=${from}&to=${to}`);
  };

  const pill = (active: boolean) =>
    `rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
      active ? "bg-ink text-white" : "bg-ink/5 text-ink"
    }`;

  return (
    <div className="sticky top-0 z-10 -mx-5 mb-1 bg-paper/90 px-5 py-2 backdrop-blur">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => {
              setShowCustom(false);
              go(k);
            }}
            className={pill(current === k)}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => setShowCustom((v) => !v)}
          className={pill(current === "custom")}
        >
          Personalizado
        </button>
      </div>
      {showCustom && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-xl border border-ink/15 px-3 py-1.5 text-sm"
          />
          <span className="opacity-40">→</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-xl border border-ink/15 px-3 py-1.5 text-sm"
          />
          <button
            onClick={goCustom}
            className="rounded-full bg-coral px-4 py-1.5 text-sm font-semibold text-white"
          >
            Ver
          </button>
        </div>
      )}
    </div>
  );
}

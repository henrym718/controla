"use client";

import { useState, useTransition } from "react";
import { cerrarDiaAction } from "../../actions";
import { Button, Card, PageTitle } from "@/components/ui";

interface Pool {
  ingredientId: string;
  name: string;
  poolCost: number;
}

export default function CierreDiaClient({ pools }: { pools: Pool[] }) {
  const [merma, setMerma] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const set = (id: string, v: string) => setMerma((m) => ({ ...m, [id]: v }));

  const submit = () => {
    const map: Record<string, number> = {};
    for (const p of pools) map[p.ingredientId] = Number(merma[p.ingredientId]) || 0;
    startTransition(() => {
      void cerrarDiaAction(map);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Cerrar el día"
        subtitle="Cuánto sobró (se botó) de cada cosa a granel; el resto se reparte entre los platos vendidos"
      />

      {pools.length === 0 && (
        <p className="rounded-2xl bg-lav p-4 text-sm">
          No hubo producción a granel hoy. Igual puedes cerrar el día.
        </p>
      )}

      {pools.map((p) => {
        const pct = Number(merma[p.ingredientId]) || 0;
        const distrib = p.poolCost * (1 - pct / 100);
        return (
          <Card key={p.ingredientId}>
            <div className="flex justify-between">
              <span className="font-semibold">{p.name}</span>
              <span className="text-sm opacity-60">pool ${p.poolCost.toFixed(2)}</span>
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm">
              ¿% que sobró/botó?
              <input
                inputMode="decimal"
                value={merma[p.ingredientId] ?? ""}
                onChange={(e) => set(p.ingredientId, e.target.value)}
                placeholder="0"
                className="w-20 rounded-xl border border-ink/15 px-2 py-1 text-right outline-none focus:border-ink/40"
              />
              %
            </label>
            <p className="mt-1 text-xs opacity-60">
              Se reparte ${distrib.toFixed(2)} entre los platos vendidos.
            </p>
          </Card>
        );
      })}

      <Button onClick={submit} disabled={pending}>
        {pending ? "Cerrando día…" : "Cerrar día y prorratear"}
      </Button>
    </div>
  );
}

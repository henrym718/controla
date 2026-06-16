"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registrarConsumo, type ConsumoLinea } from "./actions";

export interface Insumo {
  id: string;
  name: string;
  kind: "contable" | "granel";
  unit: string | null;
}

export default function ConsumoClient({
  slug,
  insumos,
}: {
  slug: string;
  insumos: Insumo[];
}) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const byId = useMemo(() => new Map(insumos.map((i) => [i.id, i])), [insumos]);
  const lines = Object.entries(qty).filter(([, v]) => Number(v) > 0);
  const count = lines.length;

  const setOne = (id: string, v: string) =>
    setQty((m) => ({ ...m, [id]: v.replace(/[^\d.]/g, "") }));

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? insumos.filter((i) => i.name.toLowerCase().includes(s)) : insumos;
  }, [insumos, search]);

  const flashMsg = (ok: boolean, text: string) => {
    setFlash({ ok, text });
    setTimeout(() => setFlash(null), ok ? 1500 : 2800);
  };

  const registrar = () => {
    if (count === 0 || pending) return;
    const payload: ConsumoLinea[] = lines.map(([id, v]) => ({
      ingredientId: id,
      name: byId.get(id)?.name ?? "",
      qty: Number(v),
    }));
    start(async () => {
      const r = await registrarConsumo(payload);
      if (r.error) flashMsg(false, r.error);
      else {
        flashMsg(true, `Consumo registrado · ${r.count} insumo${r.count === 1 ? "" : "s"}`);
        setQty({});
        setSearch("");
      }
    });
  };

  const vacio = insumos.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-paper text-ink">
      <div
        className="shrink-0 bg-ink px-5 pb-5 pt-5 text-white"
        style={{ borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}
      >
        <div className="mx-auto flex max-w-md items-center justify-between">
          <button
            onClick={() => router.push(`/${slug}/hoy`)}
            className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold"
          >
            ‹ Volver
          </button>
          <span className="text-sm font-semibold text-white/60">Consumo del día</span>
          {count > 0 ? (
            <button
              onClick={() => setQty({})}
              className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold"
            >
              Limpiar
            </button>
          ) : (
            <span className="w-[76px]" />
          )}
        </div>
        <div className="mx-auto mt-4 max-w-md text-center">
          <p className="text-2xl font-bold leading-tight">Lo que gastaste hoy</p>
          <p className="mt-1 text-sm text-white/60">
            {count === 0
              ? "Pon la cantidad de cada insumo que usaste"
              : `${count} insumo${count === 1 ? "" : "s"} marcado${count === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-40 pt-4">
        <div className="mx-auto max-w-md">
          {vacio ? (
            <div className="rounded-3xl bg-ink/[0.03] px-6 py-12 text-center">
              <p className="text-base font-semibold">Aún no hay insumos para consumo</p>
              <p className="mx-auto mt-1 max-w-xs text-sm opacity-60">
                La administradora marca en el inventario qué insumos puedes registrar aquí.
              </p>
            </div>
          ) : (
            <>
              {insumos.length > 6 && (
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar insumo…"
                  className="mb-3 w-full rounded-2xl border border-ink/15 bg-white px-4 py-2.5 text-sm outline-none focus:border-ink/40"
                />
              )}
              <div className="flex flex-col gap-2">
                {filtered.map((i) => {
                  const v = qty[i.id] ?? "";
                  const active = Number(v) > 0;
                  return (
                    <div
                      key={i.id}
                      className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${
                        active ? "border-ink bg-mint" : "border-ink/10 bg-white"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{i.name}</p>
                        {i.unit && <p className="text-xs opacity-50">en {i.unit}</p>}
                      </div>
                      <input
                        inputMode="decimal"
                        value={v}
                        onChange={(e) => setOne(i.id, e.target.value)}
                        placeholder="0"
                        className="w-20 rounded-xl border border-ink/15 bg-white px-3 py-2 text-right text-base font-semibold outline-none focus:border-ink/40"
                      />
                      <span className="w-12 text-xs opacity-50">{i.unit ?? ""}</span>
                    </div>
                  );
                })}
                {filtered.length === 0 && (
                  <p className="rounded-2xl bg-ink/[0.03] px-4 py-6 text-center text-sm opacity-50">
                    Nada con “{search}”.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {!vacio && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 px-5 pb-6">
          <div className="mx-auto max-w-md">
            <button
              onClick={registrar}
              disabled={count === 0 || pending}
              className="pointer-events-auto flex w-full items-center justify-center rounded-full bg-coral py-4 text-lg font-bold text-white shadow-lg transition active:scale-[0.99] disabled:opacity-40"
            >
              {pending
                ? "Registrando…"
                : count === 0
                  ? "Registrar consumo"
                  : `Registrar consumo · ${count} insumo${count === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      )}

      {flash && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-ink/30 px-8">
          <div className="float-in rounded-3xl bg-white px-8 py-7 text-center shadow-xl">
            <p className="text-4xl">{flash.ok ? "✅" : "⚠️"}</p>
            <p className="mt-2 max-w-[18rem] text-lg font-bold">{flash.text}</p>
          </div>
        </div>
      )}
    </div>
  );
}

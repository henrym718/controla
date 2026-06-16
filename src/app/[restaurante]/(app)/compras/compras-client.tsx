"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registrarCompra } from "./actions";

export interface Producto {
  id: string;
  name: string;
  unit: string | null;
  stock: number;
  sellable: boolean;
}

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

export default function ComprasClient({
  slug,
  productos,
}: {
  slug: string;
  productos: Producto[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState<Producto | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? productos.filter((p) => p.name.toLowerCase().includes(s)) : productos;
  }, [productos, search]);

  const flashMsg = (ok: boolean, text: string) => {
    setFlash({ ok, text });
    setTimeout(() => setFlash(null), ok ? 1600 : 2800);
  };

  const vacio = productos.length === 0;

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
          <span className="text-sm font-semibold text-white/60">Registrar compra</span>
          <span className="w-[76px]" />
        </div>
        <div className="mx-auto mt-4 max-w-md text-center">
          <p className="text-2xl font-bold leading-tight">¿Qué compraste?</p>
          <p className="mt-1 text-sm text-white/60">Toca el producto y pon cuánto compraste</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-10 pt-4">
        <div className="mx-auto max-w-md">
          {vacio ? (
            <div className="rounded-3xl bg-ink/[0.03] px-6 py-12 text-center">
              <p className="text-base font-semibold">Aún no hay productos</p>
              <p className="mx-auto mt-1 max-w-xs text-sm opacity-60">
                La administradora crea los productos en el inventario. Después aquí registras sus
                compras.
              </p>
            </div>
          ) : (
            <>
              {productos.length > 6 && (
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar producto…"
                  className="mb-3 w-full rounded-2xl border border-ink/15 bg-white px-4 py-2.5 text-sm outline-none focus:border-ink/40"
                />
              )}
              <div className="flex flex-col gap-2">
                {filtered.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSel(p)}
                    className="flex items-center gap-3 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{p.name}</p>
                      <p className="text-xs opacity-50">
                        quedan {p.stock}
                        {p.unit ? ` ${p.unit}` : ""}
                        {p.sellable ? " · de venta" : ""}
                      </p>
                    </div>
                    <span className="rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white">
                      Comprar
                    </span>
                  </button>
                ))}
                {filtered.length === 0 && (
                  <div className="rounded-2xl bg-ink/[0.03] px-4 py-6 text-center text-sm opacity-60">
                    No encuentro “{search}”. Si no existe, pídele a la administradora que lo cree.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {sel && (
        <CompraSheet
          producto={sel}
          onClose={() => setSel(null)}
          onDone={(text) => {
            setSel(null);
            flashMsg(true, text);
            router.refresh();
          }}
          onError={(text) => flashMsg(false, text)}
        />
      )}

      {flash && (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-ink/30 px-8">
          <div className="float-in rounded-3xl bg-white px-8 py-7 text-center shadow-xl">
            <p className="text-4xl">{flash.ok ? "✅" : "⚠️"}</p>
            <p className="mt-2 max-w-[18rem] text-lg font-bold">{flash.text}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function CompraSheet({
  producto,
  onClose,
  onDone,
  onError,
}: {
  producto: Producto;
  onClose: () => void;
  onDone: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [qty, setQty] = useState("");
  const [total, setTotal] = useState("");
  const [fuente, setFuente] = useState<"caja" | "jefa">("caja");
  const [pending, start] = useTransition();
  const q = Number(qty) || 0;
  const t = Number(total) || 0;

  const registrar = () => {
    if (q <= 0) return onError("Indica cuánto compraste.");
    start(async () => {
      const r = await registrarCompra({
        ingredientId: producto.id,
        name: producto.name,
        qty: q,
        totalCost: t,
        fuente,
      });
      if (r.error) onError(r.error);
      else onDone(`${q}${producto.unit ? ` ${producto.unit}` : ""} de ${producto.name} · ${money(t)}`);
    });
  };

  return (
    <div className="absolute inset-0 z-[60] flex items-end justify-center bg-ink/40" onClick={onClose}>
      <div
        className="float-in w-full max-w-md rounded-t-[28px] bg-paper p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="text-lg font-bold">{producto.name}</p>
          <button onClick={onClose} className="text-sm font-semibold opacity-50">
            Cerrar
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              ¿Cuánto compraste?{producto.unit ? ` (${producto.unit})` : ""}
            </span>
            <input
              value={qty}
              onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              autoFocus
              placeholder="0"
              className="w-full rounded-2xl border border-ink/15 bg-white px-4 py-3 text-base outline-none focus:border-ink/40"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">¿Cuánto pagaste en total?</span>
            <input
              value={total}
              onChange={(e) => setTotal(e.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              placeholder="0.00"
              className="w-full rounded-2xl border border-ink/15 bg-white px-4 py-3 text-base outline-none focus:border-ink/40"
            />
          </label>

          <div>
            <span className="mb-1 block text-sm font-medium">¿De dónde salió el dinero?</span>
            <div className="flex gap-2">
              {(
                [
                  ["caja", "De la caja"],
                  ["jefa", "Lo puso la jefa"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setFuente(v)}
                  className={`flex-1 rounded-full px-3 py-2.5 text-sm font-semibold ${
                    fuente === v ? "bg-ink text-white" : "bg-ink/5"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] opacity-50">
              {fuente === "caja"
                ? "Sale de la caja del turno (baja la caja)."
                : "La jefa lo pagó aparte: no afecta tu caja."}
            </p>
          </div>

          <button
            onClick={registrar}
            disabled={pending || q <= 0}
            className="mt-1 rounded-full bg-coral py-3.5 text-base font-bold text-white disabled:opacity-40"
          >
            {pending ? "Registrando…" : "Registrar compra"}
          </button>
        </div>
      </div>
    </div>
  );
}

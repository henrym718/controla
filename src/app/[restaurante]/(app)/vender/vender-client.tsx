"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registrarVenta, type VentaLinea } from "./actions";

export interface SellItem {
  key: string; // "plato:<id>" | "prod:<id>"
  kind: "plato" | "producto";
  id: string;
  name: string;
  price: number;
  isCombo?: boolean;
}

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

export default function VenderClient({
  slug,
  principales,
  extras,
}: {
  slug: string;
  principales: SellItem[];
  extras: SellItem[];
}) {
  const router = useRouter();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [openExtras, setOpenExtras] = useState(false);
  const [search, setSearch] = useState("");
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const byKey = useMemo(() => {
    const m = new Map<string, SellItem>();
    for (const it of [...principales, ...extras]) m.set(it.key, it);
    return m;
  }, [principales, extras]);

  const add = (key: string) =>
    setCart((c) => ({ ...c, [key]: (c[key] ?? 0) + 1 }));
  const remove = (key: string) =>
    setCart((c) => {
      const next = { ...c };
      const n = (next[key] ?? 0) - 1;
      if (n <= 0) delete next[key];
      else next[key] = n;
      return next;
    });

  const lines = Object.entries(cart).filter(([, q]) => q > 0);
  const count = lines.reduce((s, [, q]) => s + q, 0);
  const total = lines.reduce((s, [k, q]) => s + (byKey.get(k)?.price ?? 0) * q, 0);
  const extrasCount = extras.reduce((s, it) => s + (cart[it.key] ?? 0), 0);

  // Buscador: filtra lo que YA está en pantalla (platos del menú + adicionales/
  // productos) y lo muestra en una sola columna; vacío = vista estándar.
  const q = search.trim().toLowerCase();
  const searching = q.length > 0;
  const matchPrincipales = searching
    ? principales.filter((it) => it.name.toLowerCase().includes(q))
    : principales;
  const matchExtras = searching
    ? extras.filter((it) => it.name.toLowerCase().includes(q))
    : extras;

  const flashMsg = (ok: boolean, text: string) => {
    setFlash({ ok, text });
    setTimeout(() => setFlash(null), ok ? 1500 : 2800);
  };

  const registrar = () => {
    if (count === 0 || pending) return;
    const payload: VentaLinea[] = lines.map(([k, q]) => {
      const it = byKey.get(k)!;
      return { kind: it.kind, id: it.id, name: it.name, unitPrice: it.price, qty: q };
    });
    start(async () => {
      const r = await registrarVenta(payload);
      if (r.error) {
        flashMsg(false, r.error);
      } else {
        flashMsg(true, `Venta registrada · ${money(r.total ?? total)}`);
        setCart({});
        setOpenExtras(false);
        setSearch("");
      }
    });
  };

  const vacio = principales.length === 0 && extras.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-paper text-ink">
      {/* Encabezado con el total, grande, estilo transferencia */}
      <div
        className="shrink-0 bg-ink px-5 pb-6 pt-5 text-white"
        style={{ borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}
      >
        <div className="mx-auto flex max-w-md items-center justify-between">
          <button
            onClick={() => router.push(`/${slug}/hoy`)}
            className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold"
          >
            ‹ Volver
          </button>
          <span className="text-sm font-semibold text-white/60">Registrar venta</span>
          {count > 0 ? (
            <button
              onClick={() => setCart({})}
              className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold"
            >
              Vaciar
            </button>
          ) : (
            <span className="w-[76px]" />
          )}
        </div>
        <div className="mx-auto mt-5 max-w-md text-center">
          <p className="text-xs uppercase tracking-widest text-white/40">Total</p>
          <p className="mt-1 text-6xl font-bold tabular-nums">{money(total)}</p>
          <p className="mt-2 text-sm text-white/60">
            {count === 0
              ? "Toca un plato para empezar"
              : `${count} ${count === 1 ? "ítem" : "ítems"} en la venta`}
          </p>
        </div>
      </div>

      {/* Lista de platos + cajón de adicionales */}
      <div className="flex-1 overflow-y-auto px-5 pb-40 pt-5">
        <div className="mx-auto max-w-md">
          {vacio ? (
            <EmptyMenu slug={slug} />
          ) : (
            <>
              <SearchBar value={search} onChange={setSearch} onClear={() => setSearch("")} />

              {searching ? (
                matchPrincipales.length + matchExtras.length === 0 ? (
                  <p className="rounded-2xl bg-ink/[0.03] px-4 py-8 text-center text-sm opacity-50">
                    Nada con “{search.trim()}”.
                  </p>
                ) : (
                  // Resultado: una sola columna. Plato principal grande; adicional
                  // / producto más pequeño. Se agrega o quita ahí mismo.
                  <div className="flex flex-col gap-2">
                    {matchPrincipales.map((it) => (
                      <ResultRow
                        key={it.key}
                        item={it}
                        qty={cart[it.key] ?? 0}
                        onAdd={() => add(it.key)}
                        onRemove={() => remove(it.key)}
                        big
                      />
                    ))}
                    {matchExtras.map((it) => (
                      <ResultRow
                        key={it.key}
                        item={it}
                        qty={cart[it.key] ?? 0}
                        onAdd={() => add(it.key)}
                        onRemove={() => remove(it.key)}
                      />
                    ))}
                  </div>
                )
              ) : (
                <>
                  {principales.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3">
                      {principales.map((it) => (
                        <BigCard
                          key={it.key}
                          item={it}
                          qty={cart[it.key] ?? 0}
                          onAdd={() => add(it.key)}
                          onRemove={() => remove(it.key)}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-3xl bg-ink/[0.03] px-4 py-8 text-center text-sm opacity-60">
                      No hay platos principales en el menú de hoy. Revisa los adicionales abajo.
                    </p>
                  )}

                  {extras.length > 0 && (
                    <ExtrasDrawer
                      open={openExtras}
                      onToggle={() => setOpenExtras((v) => !v)}
                      extras={extras}
                      cart={cart}
                      count={extrasCount}
                      onAdd={add}
                      onRemove={remove}
                    />
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Botón principal: registrar la venta */}
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
                  ? "Registrar venta"
                  : `Registrar venta · ${money(total)}`}
            </button>
          </div>
        </div>
      )}

      {/* Confirmación / error */}
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

// --------------------------------------------------------------------------- Tarjeta grande de plato
function BigCard({
  item,
  qty,
  onAdd,
  onRemove,
}: {
  item: SellItem;
  qty: number;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const active = qty > 0;
  return (
    <div
      className={`relative flex min-h-[120px] flex-col justify-between rounded-3xl border p-4 transition ${
        active ? "border-ink bg-mint" : "border-ink/10 bg-white"
      }`}
    >
      <button onClick={onAdd} className="min-w-0 flex-1 text-left">
        <p className="text-base font-bold leading-tight">{item.name}</p>
        {item.isCombo && (
          <span className="mt-1 inline-block rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold">
            combo
          </span>
        )}
        <p className={`mt-1 text-sm font-semibold ${active ? "opacity-70" : "opacity-50"}`}>
          {money(item.price)}
        </p>
      </button>
      <div className="mt-2 flex items-center justify-end gap-2">
        {active && (
          <>
            <button
              onClick={onRemove}
              aria-label="Quitar uno"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-2xl font-bold leading-none"
            >
              −
            </button>
            <span className="min-w-6 text-center text-xl font-bold tabular-nums">{qty}</span>
          </>
        )}
        <button
          onClick={onAdd}
          aria-label="Agregar uno"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-2xl font-bold leading-none text-white"
        >
          +
        </button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- Buscador
function SearchBar({
  value,
  onChange,
  onClear,
}: {
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="relative mb-4">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Buscar plato o adicional…"
        className="w-full rounded-2xl border border-ink/15 bg-white px-4 py-4 pr-12 text-base font-medium outline-none focus:border-ink/40"
      />
      {value && (
        <button
          onClick={onClear}
          aria-label="Borrar búsqueda"
          className="absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-ink/5 text-xl font-bold leading-none"
        >
          ×
        </button>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- Fila de resultado de búsqueda
//  Una por línea. big = plato principal (grande); si no, adicional/producto (más pequeño).
function ResultRow({
  item,
  qty,
  onAdd,
  onRemove,
  big = false,
}: {
  item: SellItem;
  qty: number;
  onAdd: () => void;
  onRemove: () => void;
  big?: boolean;
}) {
  const active = qty > 0;
  return (
    <div
      className={`flex items-center gap-2 rounded-2xl border transition ${
        active ? "border-ink bg-mint" : "border-ink/10 bg-white"
      } ${big ? "px-4 py-4" : "px-3 py-2.5"}`}
    >
      <button onClick={onAdd} className="min-w-0 flex-1 text-left">
        <p className={`truncate font-bold leading-tight ${big ? "text-lg" : "text-sm"}`}>
          {item.name}
          {item.isCombo && (
            <span className="ml-1.5 inline-block rounded-full bg-white/70 px-2 py-0.5 align-middle text-[10px] font-semibold">
              combo
            </span>
          )}
        </p>
        <p
          className={`mt-0.5 font-semibold ${big ? "text-sm" : "text-xs"} ${
            active ? "opacity-70" : "opacity-50"
          }`}
        >
          {money(item.price)}
        </p>
      </button>
      {active && (
        <>
          <button
            onClick={onRemove}
            aria-label="Quitar uno"
            className={`flex items-center justify-center rounded-full bg-white font-bold leading-none ${
              big ? "h-9 w-9 text-2xl" : "h-8 w-8 text-xl"
            }`}
          >
            −
          </button>
          <span
            className={`text-center font-bold tabular-nums ${big ? "min-w-6 text-xl" : "min-w-5"}`}
          >
            {qty}
          </span>
        </>
      )}
      <button
        onClick={onAdd}
        aria-label="Agregar uno"
        className={`flex items-center justify-center rounded-full bg-ink font-bold leading-none text-white ${
          big ? "h-9 w-9 text-2xl" : "h-8 w-8 text-xl"
        }`}
      >
        +
      </button>
    </div>
  );
}

// --------------------------------------------------------------------------- Cajón de adicionales (oculto por defecto)
function ExtrasDrawer({
  open,
  onToggle,
  extras,
  cart,
  count,
  onAdd,
  onRemove,
}: {
  open: boolean;
  onToggle: () => void;
  extras: SellItem[];
  cart: Record<string, number>;
  count: number;
  onAdd: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div className="mt-5">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-2xl border border-ink/15 bg-white px-4 py-3.5 text-left"
      >
        <span className="flex items-center gap-2 text-base font-semibold">
          Adicionales
          {count > 0 && (
            <span className="rounded-full bg-coral px-2 py-0.5 text-xs font-bold text-white">
              {count}
            </span>
          )}
        </span>
        <span className="text-sm font-semibold opacity-50">
          {open ? "Ocultar ▴" : `Ver ${extras.length} ▾`}
        </span>
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {extras.map((it) => {
            const qty = cart[it.key] ?? 0;
            const active = qty > 0;
            return (
              <div
                key={it.key}
                className={`flex items-center gap-2 rounded-2xl border px-3 py-2.5 ${
                  active ? "border-ink bg-mint" : "border-ink/10 bg-white"
                }`}
              >
                <button onClick={() => onAdd(it.key)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-semibold">{it.name}</p>
                  <p className="text-xs opacity-50">{money(it.price)}</p>
                </button>
                {active && (
                  <>
                    <button
                      onClick={() => onRemove(it.key)}
                      aria-label="Quitar uno"
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-xl font-bold leading-none"
                    >
                      −
                    </button>
                    <span className="min-w-5 text-center font-bold tabular-nums">{qty}</span>
                  </>
                )}
                <button
                  onClick={() => onAdd(it.key)}
                  aria-label="Agregar uno"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-xl font-bold leading-none text-white"
                >
                  +
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- Sin menú
function EmptyMenu({ slug }: { slug: string }) {
  return (
    <div className="rounded-3xl bg-ink/[0.03] px-6 py-12 text-center">
      <p className="text-base font-semibold">Aún no hay menú para este turno</p>
      <p className="mx-auto mt-1 max-w-xs text-sm opacity-60">
        Define qué platos se venden hoy y vuelve aquí para registrar ventas con un toque.
      </p>
      <Link
        href={`/${slug}/menu`}
        className="mt-4 inline-flex rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white"
      >
        Ir al menú
      </Link>
    </div>
  );
}

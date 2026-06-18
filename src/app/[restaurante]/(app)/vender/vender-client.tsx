"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui";
import { Switch } from "@/components/ui/switch";
import {
  registrarVenta,
  registrarConsumoEmpleado,
  registrarVentaCredito,
  guardarCuenta,
  actualizarCuenta,
  cobrarCuenta,
  eliminarCuenta,
  type VentaLinea,
} from "./actions";
import { crearCliente } from "../clientes/actions";

export interface SellItem {
  key: string; // "plato:<id>" | "prod:<id>"
  kind: "plato" | "producto";
  id: string;
  name: string;
  price: number;
  isCombo?: boolean;
}
export interface CuentaLine extends SellItem {
  qty: number;
}
interface ClientePick {
  id: string;
  name: string;
  kind: "cliente" | "empleado";
}
interface CuentaResumen {
  id: string;
  label: string;
  total: number;
  count: number;
  /** Productos acumulados (cantidad × nombre), sin precio individual. */
  items: { key: string; name: string; qty: number }[];
}
interface CuentaActiva {
  id: string;
  label: string;
  lines: CuentaLine[];
}

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

export default function VenderClient({
  slug,
  principales,
  extras,
  clientes,
  cuentasAbiertas,
  cuenta,
}: {
  slug: string;
  principales: SellItem[];
  extras: SellItem[];
  clientes: ClientePick[];
  cuentasAbiertas: CuentaResumen[];
  cuenta: CuentaActiva | null;
}) {
  const router = useRouter();
  const mesaMode = !!cuenta;
  const [cart, setCart] = useState<Record<string, number>>(() =>
    cuenta ? Object.fromEntries(cuenta.lines.map((l) => [l.key, l.qty])) : {},
  );
  const [openExtras, setOpenExtras] = useState(false);
  const [search, setSearch] = useState("");
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmConsumo, setConfirmConsumo] = useState(false);
  const [guardarOpen, setGuardarOpen] = useState(false);
  const [creditoOpen, setCreditoOpen] = useState(false);
  const [cuentasOpen, setCuentasOpen] = useState(false);
  const [pending, start] = useTransition();

  // Al cambiar la cuenta activa (entrar a una mesa, volver a venta normal, o
  // cobrar/guardar y volver), reinicia carrito y modales. Sin esto Next reutiliza
  // el mismo componente entre navegaciones de ?cuenta= y el carrito quedaba pegado:
  // al "Agregar" no aparecían los ítems de la mesa y al "Guardar cambios" se volvía
  // con el carrito lleno.
  const cuentaKey = cuenta?.id ?? null;
  useEffect(() => {
    setCart(cuenta ? Object.fromEntries(cuenta.lines.map((l) => [l.key, l.qty])) : {});
    setSearch("");
    setOpenExtras(false);
    setCuentasOpen(false);
    setGuardarOpen(false);
    setCreditoOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuentaKey]);

  // byKey incluye los ítems de la cuenta que ya no estén en el menú de hoy, para
  // que el carrito sepa su precio (la cuenta guarda su propio precio).
  const byKey = useMemo(() => {
    const m = new Map<string, SellItem>();
    for (const it of [...principales, ...extras]) m.set(it.key, it);
    if (cuenta)
      for (const l of cuenta.lines)
        if (!m.has(l.key))
          m.set(l.key, { key: l.key, kind: l.kind, id: l.id, name: l.name, price: l.price, isCombo: l.isCombo });
    return m;
  }, [principales, extras, cuenta]);

  const add = (key: string) => setCart((c) => ({ ...c, [key]: (c[key] ?? 0) + 1 }));
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
  const buildPayload = (): VentaLinea[] =>
    lines.map(([k, qn]) => {
      const it = byKey.get(k)!;
      return { kind: it.kind, id: it.id, name: it.name, unitPrice: it.price, qty: qn };
    });
  const clearAll = () => {
    setCart({});
    setOpenExtras(false);
    setSearch("");
  };

  // ---- Cobrar ahora (efectivo) ----
  const registrar = () => {
    if (count === 0 || pending) return;
    const payload = buildPayload();
    start(async () => {
      const r = await registrarVenta(payload);
      if (r.error) flashMsg(false, r.error);
      else {
        flashMsg(true, `Venta registrada · ${money(r.total ?? total)}`);
        clearAll();
      }
    });
  };

  // ---- Consumo de empleado (gratis, solo platos) ----
  const consumoEmpleado = () => {
    if (count === 0 || pending) return;
    setConfirmConsumo(false);
    const payload = buildPayload();
    start(async () => {
      const r = await registrarConsumoEmpleado(payload);
      if (r.error) flashMsg(false, r.error);
      else {
        flashMsg(true, `Consumo de empleado${r.note ? ` · ${r.note}` : ""}`);
        setCart((c) => {
          const next: Record<string, number> = {};
          for (const [k, v] of Object.entries(c)) if (k.startsWith("prod:")) next[k] = v;
          return next;
        });
        setSearch("");
      }
    });
  };

  // ---- Guardar cuenta nueva (borrador) ----
  const guardarNueva = (label: string) => {
    if (count === 0 || pending) return;
    const payload = buildPayload();
    start(async () => {
      const r = await guardarCuenta(label, payload);
      if (r.error) flashMsg(false, r.error);
      else {
        setGuardarOpen(false);
        flashMsg(true, `Cuenta guardada · ${label.trim() || "Mesa"}`);
        clearAll();
        router.refresh();
      }
    });
  };

  // ---- Modo cuenta: guardar cambios / cobrar ----
  const guardarCambios = () => {
    if (!cuenta || count === 0 || pending) return;
    const payload = buildPayload();
    start(async () => {
      const r = await actualizarCuenta(cuenta.id, cuenta.label, payload);
      if (r.error) flashMsg(false, r.error);
      else {
        flashMsg(true, "Cuenta actualizada");
        router.push(`/${slug}/vender`);
        router.refresh();
      }
    });
  };
  const cobrarMesa = () => {
    if (!cuenta || count === 0 || pending) return;
    const payload = buildPayload();
    start(async () => {
      // Guarda lo que se ve y luego cobra, para no dejar fuera lo recién agregado.
      const up = await actualizarCuenta(cuenta.id, cuenta.label, payload);
      if (up.error) {
        flashMsg(false, up.error);
        return;
      }
      const r = await cobrarCuenta(cuenta.id);
      if (r.error) flashMsg(false, r.error);
      else {
        flashMsg(true, `Cuenta cobrada · ${money(r.total ?? 0)}`);
        router.push(`/${slug}/vender`);
        router.refresh();
      }
    });
  };

  // ---- Crédito (fiado) ----
  const fiar = (clienteId: string) => {
    if (count === 0 || pending || !clienteId) return;
    const payload = buildPayload();
    start(async () => {
      const r = await registrarVentaCredito(payload, clienteId);
      if (r.error) flashMsg(false, r.error);
      else {
        setCreditoOpen(false);
        flashMsg(true, `Fiado · ${money(r.total ?? total)}`);
        clearAll();
        router.refresh();
      }
    });
  };

  // ---- Lista de cuentas abiertas: cobrar / eliminar ----
  const cobrarDeLista = (id: string) => {
    if (pending) return;
    start(async () => {
      const r = await cobrarCuenta(id);
      if (r.error) flashMsg(false, r.error);
      else {
        setCuentasOpen(false);
        flashMsg(true, `Cuenta cobrada · ${money(r.total ?? 0)}`);
        router.refresh();
      }
    });
  };
  const eliminarDeLista = (id: string) => {
    if (pending) return;
    start(async () => {
      const r = await eliminarCuenta(id);
      if (r.error) flashMsg(false, r.error);
      else {
        flashMsg(true, "Cuenta eliminada");
        router.refresh();
      }
    });
  };

  const vacio = principales.length === 0 && extras.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-paper text-ink">
      {/* Encabezado con el total */}
      <div
        className="shrink-0 bg-ink px-5 pb-5 pt-4 text-white"
        style={{ borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}
      >
        <div className="mx-auto flex max-w-md items-center justify-between">
          <button
            onClick={() => router.push(mesaMode ? `/${slug}/vender` : `/${slug}/hoy`)}
            className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold"
          >
            ‹ Volver
          </button>
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
        <div className="mx-auto mt-3 max-w-md text-center">
          <p className="text-6xl font-bold tabular-nums">{money(total)}</p>
        </div>
      </div>

      {/* Lista de platos + adicionales */}
      <div className="flex-1 overflow-y-auto px-5 pb-52 pt-5">
        <div className="mx-auto max-w-md">
          {/* Título de la mesa (modo cuenta) */}
          {mesaMode && (
            <p className="mb-3 text-2xl font-bold">Agregar a {cuenta!.label}</p>
          )}

          {/* Barra de cuentas abiertas (solo en venta normal) */}
          {!mesaMode && cuentasAbiertas.length > 0 && (
            <button
              onClick={() => setCuentasOpen(true)}
              className="mb-4 flex w-full items-center justify-between rounded-2xl border border-ink/15 bg-white px-4 py-3 text-left"
            >
              <span className="flex items-center gap-2 text-base font-semibold">
                🧾 Cuentas abiertas
                <span className="rounded-full bg-coral px-2 py-0.5 text-xs font-bold text-white">
                  {cuentasAbiertas.length}
                </span>
              </span>
              <span className="text-sm font-semibold opacity-50">Ver ›</span>
            </button>
          )}

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
                  <div className="flex flex-col gap-2">
                    {[...matchPrincipales, ...matchExtras].map((it) => (
                      <ItemRow
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
                    <div className="flex flex-col gap-2">
                      {principales.map((it) => (
                        <ItemRow
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

      {/* Acciones */}
      {!vacio && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 px-5 pb-6">
          <div className="mx-auto flex max-w-md flex-col gap-2">
            {mesaMode ? (
              <>
                <button
                  onClick={cobrarMesa}
                  disabled={count === 0 || pending}
                  className="pointer-events-auto flex w-full items-center justify-center rounded-full bg-coral py-4 text-lg font-bold text-white shadow-lg transition active:scale-[0.99] disabled:opacity-40"
                >
                  {pending ? "Procesando…" : `Cobrar ${cuenta!.label} · ${money(total)}`}
                </button>
                <button
                  onClick={guardarCambios}
                  disabled={count === 0 || pending}
                  className="pointer-events-auto flex w-full items-center justify-center rounded-full border-2 border-coral bg-ink py-4 text-lg font-bold text-white transition active:scale-[0.99] disabled:opacity-40"
                >
                  Guardar cambios
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={registrar}
                  disabled={count === 0 || pending}
                  className="pointer-events-auto flex w-full items-center justify-center rounded-full bg-coral py-4 text-lg font-bold text-white shadow-lg transition active:scale-[0.99] disabled:opacity-40"
                >
                  {pending ? "Procesando…" : count === 0 ? "Cobrar ahora" : `Cobrar ahora · ${money(total)}`}
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <SecBtn label="Pendiente de cobro" onClick={() => setGuardarOpen(true)} disabled={count === 0 || pending} />
                  <SecBtn label="Venta a crédito" onClick={() => setCreditoOpen(true)} disabled={count === 0 || pending} />
                  <SecBtn
                    label="Consumo de empleada"
                    onClick={() => setConfirmConsumo(true)}
                    disabled={count === 0 || pending}
                    className="col-span-2"
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Guardar cuenta */}
      <Modal open={guardarOpen} onClose={() => setGuardarOpen(false)}>
        <GuardarCuentaForm
          sugerido={`Mesa ${cuentasAbiertas.length + 1}`}
          total={total}
          pending={pending}
          onGuardar={guardarNueva}
        />
      </Modal>

      {/* Crédito (fiado) */}
      <Modal open={creditoOpen} onClose={() => setCreditoOpen(false)}>
        <CreditoForm clientes={clientes} total={total} pending={pending} onFiar={fiar} />
      </Modal>

      {/* Cuentas abiertas */}
      <Modal open={cuentasOpen} onClose={() => setCuentasOpen(false)}>
        <div className="flex flex-col gap-3">
          <p className="text-lg font-bold">Cuentas abiertas</p>
          <p className="text-sm opacity-60">Agrega más, cobra o elimina una cuenta.</p>
          <div className="flex flex-col gap-2">
            {cuentasAbiertas.map((c) => (
              <div key={c.id} className="rounded-2xl border border-ink/10 bg-white p-3">
                <div className="flex items-center justify-between">
                  <p className="text-lg font-bold">{c.label}</p>
                  <p className="text-lg font-bold tabular-nums">{money(c.total)}</p>
                </div>
                {/* Detalle de lo que se está cobrando, con letras grandes y sin
                    precio por ítem: "2 × Bandeja". Para confirmar de un vistazo. */}
                <ul className="mt-2 flex flex-col gap-1.5">
                  {c.items.map((it) => (
                    <li key={it.key} className="flex items-baseline gap-2.5 leading-snug">
                      <span className="min-w-8 shrink-0 rounded-lg bg-coral/10 px-1.5 py-0.5 text-center text-lg font-extrabold tabular-nums text-coral">
                        {it.qty}
                      </span>
                      <span className="text-lg font-bold">{it.name}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Link
                    href={`/${slug}/vender?cuenta=${c.id}`}
                    onClick={() => setCuentasOpen(false)}
                    className="rounded-full bg-ink/5 py-2 text-center text-sm font-semibold text-ink"
                  >
                    Agregar
                  </Link>
                  <button
                    onClick={() => cobrarDeLista(c.id)}
                    disabled={pending}
                    className="rounded-full bg-coral py-2 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    Cobrar
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`¿Eliminar la cuenta ${c.label}?`)) eliminarDeLista(c.id);
                    }}
                    disabled={pending}
                    className="rounded-full bg-coral/10 py-2 text-sm font-semibold text-coral disabled:opacity-40"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      {/* Confirmar consumo de empleado */}
      {confirmConsumo && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink/30 px-8">
          <div className="float-in w-full max-w-sm rounded-3xl bg-white px-7 py-6 text-center shadow-xl">
            <p className="text-3xl">🍽️</p>
            <p className="mt-2 text-lg font-bold">¿Marcar como consumo de empleado?</p>
            <p className="mx-auto mt-1 max-w-[17rem] text-sm opacity-60">
              Es gratis: no suma a la venta y no afecta tu caja. Solo descuenta los
              ingredientes del inventario.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setConfirmConsumo(false)}
                className="flex-1 rounded-full border border-ink/15 bg-white py-3 font-bold text-ink"
              >
                Cancelar
              </button>
              <button
                onClick={consumoEmpleado}
                className="flex-1 rounded-full bg-ink py-3 font-bold text-white"
              >
                Sí, consumo
              </button>
            </div>
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

// --------------------------------------------------------------------------- Botón secundario (acciones de venta)
function SecBtn({
  label,
  onClick,
  disabled,
  className = "",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`pointer-events-auto flex items-center justify-center rounded-full border-2 border-coral bg-ink px-2 py-3.5 text-center text-sm font-bold leading-tight text-white transition active:scale-[0.98] disabled:opacity-40 ${className}`}
    >
      {label}
    </button>
  );
}

// --------------------------------------------------------------------------- Guardar cuenta (etiqueta "Mesa N", editable)
function GuardarCuentaForm({
  sugerido,
  total,
  pending,
  onGuardar,
}: {
  sugerido: string;
  total: number;
  pending: boolean;
  onGuardar: (label: string) => void;
}) {
  const [label, setLabel] = useState(sugerido);
  const bump = (d: number) =>
    setLabel((l) => {
      const m = l.match(/^(.*?)(\d+)\s*$/);
      if (m) return `${m[1]}${Math.max(1, parseInt(m[2], 10) + d)}`;
      return l;
    });
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-lg font-bold">Pendiente de cobro</p>
        <p className="mt-0.5 text-sm opacity-60">
          Registra la venta sin cobrar. La cobras luego en “Cuentas abiertas”.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => bump(-1)}
          aria-label="Bajar número"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-ink/5 text-2xl font-bold"
        >
          ‹
        </button>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Mesa 1"
          className="w-full rounded-2xl border border-ink/15 bg-white px-4 py-3 text-center text-lg font-bold outline-none focus:border-ink/40"
        />
        <button
          onClick={() => bump(1)}
          aria-label="Subir número"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-ink/5 text-2xl font-bold"
        >
          ›
        </button>
      </div>
      <button
        onClick={() => onGuardar(label)}
        disabled={pending}
        className="flex w-full items-center justify-center rounded-full bg-coral py-4 text-lg font-bold text-white disabled:opacity-40"
      >
        {pending ? "Guardando…" : `Guardar · ${money(total)}`}
      </button>
    </div>
  );
}

// --------------------------------------------------------------------------- Crédito (elegir / crear cliente)
function CreditoForm({
  clientes,
  total,
  pending,
  onFiar,
}: {
  clientes: ClientePick[];
  total: number;
  pending: boolean;
  onFiar: (clienteId: string) => void;
}) {
  const [s, setS] = useState("");
  const [nuevo, setNuevo] = useState(false);
  const [nombre, setNombre] = useState("");
  const [empleado, setEmpleado] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [creating, startCreate] = useTransition();

  const f = s.trim().toLowerCase();
  const list = f ? clientes.filter((c) => c.name.toLowerCase().includes(f)) : clientes;

  const crearYFiar = () => {
    setErr(null);
    if (!nombre.trim()) {
      setErr("Escribe el nombre.");
      return;
    }
    startCreate(async () => {
      const r = await crearCliente({ name: nombre.trim(), kind: empleado ? "empleado" : "cliente" });
      if (r.error) {
        setErr(r.error);
        return;
      }
      if (r.id) onFiar(r.id);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-lg font-bold">Fiar (venta a crédito)</p>
        <p className="mt-0.5 text-sm opacity-60">Elige a quién se le fía · {money(total)}</p>
      </div>

      {!nuevo ? (
        <>
          <input
            value={s}
            onChange={(e) => setS(e.target.value)}
            placeholder="Buscar persona…"
            className="w-full rounded-2xl border border-ink/15 bg-white px-4 py-3 text-base outline-none focus:border-ink/40"
          />
          <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
            {list.map((c) => (
              <button
                key={c.id}
                onClick={() => onFiar(c.id)}
                disabled={pending}
                className="flex items-center justify-between rounded-2xl border border-ink/10 bg-white px-4 py-3 text-left disabled:opacity-50"
              >
                <span className="font-semibold">{c.name}</span>
                <span className="text-xs opacity-50">{c.kind}</span>
              </button>
            ))}
            {list.length === 0 && (
              <p className="rounded-2xl bg-ink/[0.03] px-4 py-6 text-center text-sm opacity-50">
                {clientes.length === 0 ? "Aún no hay personas registradas." : `Nadie con “${s.trim()}”.`}
              </p>
            )}
          </div>
          <button
            onClick={() => setNuevo(true)}
            className="rounded-full border border-ink/15 bg-white py-3 text-base font-bold text-ink"
          >
            ＋ Registrar persona nueva
          </button>
        </>
      ) : (
        <>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre de la persona"
            className="w-full rounded-2xl border border-ink/15 bg-white px-4 py-3 text-base outline-none focus:border-ink/40"
          />
          <div className="flex items-center justify-between rounded-2xl bg-ink/5 px-4 py-3">
            <div>
              <p className="text-sm font-semibold">{empleado ? "Empleado" : "Cliente"}</p>
              <p className="text-xs opacity-60">
                {empleado ? "Trabaja en el negocio" : "Cliente del local"}
              </p>
            </div>
            <Switch checked={empleado} onCheckedChange={(v) => setEmpleado(v)} />
          </div>
          {err && <p className="text-sm font-semibold text-coral">{err}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => setNuevo(false)}
              className="flex-1 rounded-full border border-ink/15 bg-white py-3 font-bold text-ink"
            >
              Volver
            </button>
            <button
              onClick={crearYFiar}
              disabled={creating || pending}
              className="flex-1 rounded-full bg-coral py-3 font-bold text-white disabled:opacity-40"
            >
              {creating || pending ? "…" : "Crear y fiar"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- Fila de ítem (platos, adicionales y resultados — mismo formato, letra grande)
//  Una por fila, nombre en bold grande y precio en gris (negrita normal).
function ItemRow({
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
      className={`flex items-center gap-3 rounded-2xl border px-4 py-3 transition ${
        active ? "border-ink bg-mint" : "border-ink/10 bg-white"
      }`}
    >
      <button onClick={onAdd} className="min-w-0 flex-1 text-left">
        <p className="text-xl font-bold leading-snug">
          {item.name}
          {item.isCombo && (
            <span className="ml-1.5 inline-block rounded-full bg-white/70 px-2 py-0.5 align-middle text-[11px] font-semibold">
              combo
            </span>
          )}
        </p>
        <p className={`mt-0.5 text-lg font-semibold tabular-nums ${active ? "text-ink/70" : "text-ink/50"}`}>
          {money(item.price)}
        </p>
      </button>
      {active && (
        <>
          <button
            onClick={onRemove}
            aria-label="Quitar uno"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-2xl font-bold leading-none"
          >
            −
          </button>
          <span className="min-w-7 shrink-0 text-center text-xl font-bold tabular-nums">{qty}</span>
        </>
      )}
      <button
        onClick={onAdd}
        aria-label="Agregar uno"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-2xl font-bold leading-none text-white"
      >
        +
      </button>
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

// --------------------------------------------------------------------------- Cajón de adicionales
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
          {extras.map((it) => (
            <ItemRow
              key={it.key}
              item={it}
              qty={cart[it.key] ?? 0}
              onAdd={() => onAdd(it.key)}
              onRemove={() => onRemove(it.key)}
            />
          ))}
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
        href={`/${slug}/menu/editar`}
        className="mt-4 inline-flex rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white"
      >
        Ir al menú
      </Link>
    </div>
  );
}

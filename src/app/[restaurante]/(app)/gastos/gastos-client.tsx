"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui";
import { registrarGastos, type FuentePago, type GastoLinea } from "./actions";

interface Row {
  id: number;
  name: string;
  amount: string;
}

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

export default function GastosClient({ slug }: { slug: string }) {
  const router = useRouter();
  const idRef = useRef(0);
  const newRow = (): Row => ({ id: ++idRef.current, name: "", amount: "" });

  const [rows, setRows] = useState<Row[]>(() => [newRow()]);
  const [askFuente, setAskFuente] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const valid = rows
    .map((r) => ({ name: r.name.trim(), amount: Number(r.amount) }))
    .filter((r) => r.name && r.amount > 0);
  const total = valid.reduce((s, r) => s + r.amount, 0);
  const count = valid.length;

  const setRow = (id: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, newRow()]);
  const removeRow = (id: number) =>
    setRows((rs) => (rs.length === 1 ? [newRow()] : rs.filter((r) => r.id !== id)));
  const limpiar = () => setRows([newRow()]);

  const flashMsg = (ok: boolean, text: string) => {
    setFlash({ ok, text });
    setTimeout(() => setFlash(null), ok ? 1600 : 2800);
  };

  const confirmar = (fuente: FuentePago) => {
    if (count === 0 || pending) return;
    const payload: GastoLinea[] = valid;
    start(async () => {
      const r = await registrarGastos(payload, fuente);
      setAskFuente(false);
      if (r.error) flashMsg(false, r.error);
      else {
        flashMsg(
          true,
          `Gasto registrado · ${r.count} gasto${r.count === 1 ? "" : "s"} · ${money(r.total ?? 0)}`,
        );
        limpiar();
      }
    });
  };

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
          <span className="text-sm font-semibold text-white/60">Gastos del turno</span>
          {count > 0 ? (
            <button
              onClick={limpiar}
              className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold"
            >
              Limpiar
            </button>
          ) : (
            <span className="w-[76px]" />
          )}
        </div>
        <div className="mx-auto mt-4 max-w-md text-center">
          <p className="text-2xl font-bold leading-tight">¿Qué se pagó hoy?</p>
          <p className="mt-1 text-sm text-white/60">
            {count === 0
              ? "Escribe en qué gastaste y cuánto"
              : `${count} gasto${count === 1 ? "" : "s"} · ${money(total)}`}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-40 pt-4">
        <div className="mx-auto max-w-md">
          <div className="flex flex-col gap-2">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-2">
                <input
                  value={r.name}
                  onChange={(e) => setRow(r.id, { name: e.target.value })}
                  placeholder="¿En qué gastaste?"
                  className="min-w-0 flex-1 rounded-2xl border border-ink/15 bg-white px-4 py-3 text-base outline-none focus:border-ink/40"
                />
                <div className="flex items-center rounded-2xl border border-ink/15 bg-white pl-3 focus-within:border-ink/40">
                  <span className="text-base opacity-40">$</span>
                  <input
                    inputMode="decimal"
                    value={r.amount}
                    onChange={(e) =>
                      setRow(r.id, { amount: e.target.value.replace(/[^\d.]/g, "") })
                    }
                    placeholder="0"
                    className="w-16 bg-transparent px-2 py-3 text-right text-base font-semibold outline-none"
                  />
                </div>
                {rows.length > 1 ? (
                  <button
                    onClick={() => removeRow(r.id)}
                    aria-label="Quitar gasto"
                    className="shrink-0 rounded-full p-2 text-xl leading-none text-ink/30 transition active:scale-90"
                  >
                    ✕
                  </button>
                ) : (
                  <span className="w-9 shrink-0" />
                )}
              </div>
            ))}
          </div>

          <button
            onClick={addRow}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-ink/25 py-3 text-sm font-semibold text-ink/60 transition active:scale-[0.99]"
          >
            ＋ Agregar otro gasto
          </button>

          <p className="mt-4 text-center text-xs opacity-50">
            Servicios, gas, escoba, una compra rápida… lo que se pagó hoy.
          </p>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 px-5 pb-6">
        <div className="mx-auto max-w-md">
          <button
            onClick={() => setAskFuente(true)}
            disabled={count === 0 || pending}
            className="pointer-events-auto flex w-full items-center justify-center rounded-full bg-coral py-4 text-lg font-bold text-white shadow-lg transition active:scale-[0.99] disabled:opacity-40"
          >
            {count === 0
              ? "Confirmar gasto"
              : `Confirmar gasto · ${money(total)}`}
          </button>
        </div>
      </div>

      <Modal open={askFuente} onClose={() => !pending && setAskFuente(false)}>
        <div className="text-center">
          <p className="text-xl font-bold">¿De dónde salió el dinero?</p>
          <p className="mt-1 text-sm opacity-60">
            {count} gasto{count === 1 ? "" : "s"} · {money(total)}
          </p>
        </div>
        <div className="mt-5 flex flex-col gap-3">
          <button
            onClick={() => confirmar("caja")}
            disabled={pending}
            className="rounded-3xl bg-coral px-5 py-4 text-left text-white transition active:scale-[0.99] disabled:opacity-50"
          >
            <span className="block text-lg font-bold leading-tight">De la caja</span>
            <span className="mt-0.5 block text-sm text-white/80">
              Sale del cuadre de caja del turno
            </span>
          </button>
          <button
            onClick={() => confirmar("jefa")}
            disabled={pending}
            className="rounded-3xl bg-lav px-5 py-4 text-left transition active:scale-[0.99] disabled:opacity-50"
          >
            <span className="block text-lg font-bold leading-tight">La puso la jefa</span>
            <span className="mt-0.5 block text-sm opacity-60">
              No afecta tu caja — queda como costo
            </span>
          </button>
          <button
            onClick={() => !pending && setAskFuente(false)}
            disabled={pending}
            className="mt-1 rounded-3xl py-3 text-sm font-semibold opacity-50"
          >
            {pending ? "Registrando…" : "Cancelar"}
          </button>
        </div>
      </Modal>

      {flash && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-ink/30 px-8">
          <div className="float-in rounded-3xl bg-white px-8 py-7 text-center shadow-xl">
            <p className="text-4xl">{flash.ok ? "✅" : "⚠️"}</p>
            <p className="mt-2 max-w-[18rem] text-lg font-bold">{flash.text}</p>
          </div>
        </div>
      )}
    </div>
  );
}

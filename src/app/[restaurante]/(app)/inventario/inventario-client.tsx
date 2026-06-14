"use client";

import { useState, useTransition } from "react";
import { PageTitle } from "@/components/ui";
import {
  agregarProductoInventario,
  ajustarInventario,
  procesarInsumoAction,
} from "../admin/actions";

interface Product {
  id: string;
  name: string;
  cost: number;
  stock: number;
  sellable: boolean;
  salePrice: number | null;
}

const inputCls =
  "w-full rounded-xl border border-ink/15 px-3 py-2 text-sm outline-none focus:border-ink/40";

export default function InventarioClient({ products }: { products: Product[] }) {
  const [showAdd, setShowAdd] = useState(false);
  const [showProcesar, setShowProcesar] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <PageTitle title="Inventario" />
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowProcesar(true)}
            className="rounded-full bg-lav px-4 py-2 text-sm font-semibold"
          >
            Procesar
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-ink text-2xl font-bold text-white"
            aria-label="Agregar producto"
          >
            +
          </button>
        </div>
      </div>

      {/* tabla */}
      <div className="overflow-hidden rounded-3xl border border-ink/10">
        <div className="flex bg-ink/5 px-4 py-2 text-xs font-semibold opacity-60">
          <span className="flex-1">Producto</span>
          <span className="w-16 text-right">Stock</span>
          <span className="w-20 text-right">Costo</span>
        </div>
        {products.map((p) => (
          <div key={p.id} className="border-t border-ink/5">
            <button
              onClick={() => setEditing(editing === p.id ? null : p.id)}
              className="flex w-full items-center px-4 py-3 text-left text-sm"
            >
              <span className="flex-1 font-medium">
                {p.name}
                {p.sellable && p.salePrice != null && (
                  <span className="ml-2 rounded-full bg-mint px-2 py-0.5 text-[11px] font-semibold">
                    vende ${p.salePrice.toFixed(2)}
                  </span>
                )}
              </span>
              <span className="w-16 text-right">{p.stock}</span>
              <span className="w-20 text-right opacity-70">${p.cost.toFixed(2)}</span>
            </button>
            {editing === p.id && (
              <AjusteForm item={p} onDone={() => setEditing(null)} />
            )}
          </div>
        ))}
        {products.length === 0 && (
          <p className="px-4 py-6 text-center text-sm opacity-50">
            Sin productos. Toca + para agregar.
          </p>
        )}
      </div>

      <p className="text-center text-xs opacity-50">
        Toca un producto para ajustar su conteo físico (requiere PIN de admin).
      </p>

      {showAdd && <AddModal onClose={() => setShowAdd(false)} />}
      {showProcesar && (
        <ProcesarModal products={products} onClose={() => setShowProcesar(false)} />
      )}
    </div>
  );
}

function ProcesarModal({
  products,
  onClose,
}: {
  products: Product[];
  onClose: () => void;
}) {
  const [inputId, setInputId] = useState(products[0]?.id ?? "");
  const [inputQty, setInputQty] = useState("");
  const [outputName, setOutputName] = useState("");
  const [outputUnits, setOutputUnits] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const input = products.find((p) => p.id === inputId);
  const iq = Number(inputQty) || 0;
  const cost = (input?.cost ?? 0) * iq;
  const ou = Number(outputUnits) || 0;

  const submit = () => {
    setMsg(null);
    if (!inputId || iq <= 0) return setMsg("Elige el insumo y cuánto se usó.");
    if (!outputName.trim()) return setMsg("Escribe qué salió (presa, tajada, tortilla…).");
    start(async () => {
      const r = await procesarInsumoAction({
        inputId,
        inputQty: iq,
        outputName: outputName.trim(),
        outputUnits: ou > 0 ? ou : null,
      });
      if (r.error) setMsg(r.error);
      else onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-3xl bg-white p-5">
        <p className="text-lg font-bold">Procesar insumo</p>
        <p className="mb-3 text-xs opacity-50">
          Ej: de 2 pollos salieron 28 presas. Hereda el costo del crudo.
        </p>
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium opacity-60">Insumo crudo (sale del stock)</label>
          <select
            value={inputId}
            onChange={(e) => setInputId(e.target.value)}
            className={inputCls}
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (stock {p.stock})
              </option>
            ))}
          </select>
          <input
            value={inputQty}
            onChange={(e) => setInputQty(e.target.value)}
            inputMode="decimal"
            className={inputCls}
            placeholder="¿Cuánto se usó? (ej. 2)"
          />
          <p className="text-center text-xs opacity-60">
            Costo que se traslada: <span className="font-bold">${cost.toFixed(2)}</span>
          </p>
          <label className="text-xs font-medium opacity-60">¿Qué salió?</label>
          <input
            value={outputName}
            onChange={(e) => setOutputName(e.target.value)}
            className={inputCls}
            placeholder="Presa, tajada, tortilla…"
          />
          <input
            value={outputUnits}
            onChange={(e) => setOutputUnits(e.target.value)}
            inputMode="numeric"
            className={inputCls}
            placeholder="¿Cuántas salieron? (vacío = a granel)"
          />
          {ou > 0 && iq > 0 && (
            <p className="text-center text-xs opacity-60">
              Costo por unidad: <span className="font-bold">${(cost / ou).toFixed(2)}</span>
            </p>
          )}
          <div className="mt-1 flex gap-2">
            <button
              onClick={submit}
              disabled={pending}
              className="flex-1 rounded-full bg-ink py-3 font-semibold text-white"
            >
              {pending ? "Guardando…" : "Procesar"}
            </button>
            <button onClick={onClose} className="rounded-full border border-ink/15 px-5 py-3 font-semibold">
              Cancelar
            </button>
          </div>
          {msg && <p className="text-center text-sm text-coral">{msg}</p>}
        </div>
      </div>
    </div>
  );
}

function AddModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [total, setTotal] = useState("");
  const [sellable, setSellable] = useState(false);
  const [salePrice, setSalePrice] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const q = Number(qty) || 0;
  const t = Number(total) || 0;
  const unit = q > 0 ? t / q : 0;
  const sp = Number(salePrice) || 0;

  const submit = () => {
    setMsg(null);
    if (!name.trim() || q <= 0) return setMsg("Completa nombre y cantidad.");
    if (sellable && sp <= 0) return setMsg("Indica el precio de venta.");
    start(async () => {
      const r = await agregarProductoInventario({
        name: name.trim(),
        qty: q,
        totalCost: t,
        salePrice: sellable ? sp : null,
      });
      if (r.error) setMsg(r.error);
      else onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-3xl bg-white p-5">
        <p className="text-lg font-bold">Agregar producto</p>
        <p className="mb-3 text-xs opacity-50">Ej: 10 gaseosas por $10</p>
        <div className="flex flex-col gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Nombre del producto" />
          <div className="flex gap-2">
            <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" className={inputCls} placeholder="Cantidad" />
            <input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" className={inputCls} placeholder="Costo total $" />
          </div>
          <p className="text-center text-sm">
            Costo por unidad: <span className="font-bold">${unit.toFixed(2)}</span>
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sellable}
              onChange={(e) => setSellable(e.target.checked)}
              className="h-4 w-4"
            />
            Se vende directo (cola, agua…)
          </label>
          {sellable && (
            <input
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
              inputMode="decimal"
              className={inputCls}
              placeholder="Precio de venta $"
            />
          )}
          <div className="mt-1 flex gap-2">
            <button onClick={submit} disabled={pending} className="flex-1 rounded-full bg-ink py-3 font-semibold text-white">
              {pending ? "Guardando…" : "Agregar"}
            </button>
            <button onClick={onClose} className="rounded-full border border-ink/15 px-5 py-3 font-semibold">
              Cancelar
            </button>
          </div>
          {msg && <p className="text-center text-sm text-coral">{msg}</p>}
        </div>
      </div>
    </div>
  );
}

function AjusteForm({ item, onDone }: { item: Product; onDone: () => void }) {
  const [qty, setQty] = useState(String(item.stock));
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const diff = (Number(qty) || 0) - item.stock;

  const submit = () => {
    setMsg(null);
    if (!reason.trim()) return setMsg("El motivo es obligatorio.");
    if (pin.length < 3) return setMsg("Ingresa el PIN de administradora.");
    start(async () => {
      const r = await ajustarInventario({
        ingredientId: item.id,
        newQty: Number(qty) || 0,
        reason: reason.trim(),
        pin,
      });
      if (r.error) setMsg(r.error);
      else onDone();
    });
  };

  return (
    <div className="flex flex-col gap-2 border-t border-ink/10 bg-ink/[0.02] px-4 py-3">
      <div className="flex items-center gap-2">
        <input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} className={inputCls} placeholder="Conteo real" />
        <span className={`text-sm font-semibold ${diff === 0 ? "opacity-40" : "text-coral"}`}>
          {diff > 0 ? `+${diff}` : diff}
        </span>
      </div>
      <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="Motivo (ej. desfase / robo)" />
      <input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} className={inputCls} placeholder="PIN de administradora" />
      <div className="flex gap-2">
        <button onClick={submit} disabled={pending} className="flex-1 rounded-full bg-ink py-2 text-sm font-semibold text-white">
          {pending ? "Guardando…" : "Confirmar ajuste"}
        </button>
        <button onClick={onDone} className="rounded-full border border-ink/15 px-4 py-2 text-sm font-semibold">
          Cancelar
        </button>
      </div>
      {msg && <p className="text-center text-sm text-coral">{msg}</p>}
    </div>
  );
}

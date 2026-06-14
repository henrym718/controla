"use client";

import { useState, useTransition } from "react";
import { PageTitle } from "@/components/ui";
import {
  agregarProductoInventario,
  editarProductoInventario,
  eliminarProductoInventario,
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
              onClick={() => setEditing(p.id)}
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
          </div>
        ))}
        {products.length === 0 && (
          <p className="px-4 py-6 text-center text-sm opacity-50">
            Sin productos. Toca + para agregar.
          </p>
        )}
      </div>

      <p className="text-center text-xs opacity-50">
        Toca un producto para editarlo o ajustar su stock (requiere PIN de admin).
      </p>

      {showAdd && <AddModal onClose={() => setShowAdd(false)} />}
      {showProcesar && (
        <ProcesarModal products={products} onClose={() => setShowProcesar(false)} />
      )}
      {editing && (
        <EditModal
          item={products.find((p) => p.id === editing)!}
          onClose={() => setEditing(null)}
        />
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

function EditModal({ item, onClose }: { item: Product; onClose: () => void }) {
  const [name, setName] = useState(item.name);
  const [cost, setCost] = useState(item.cost ? String(item.cost) : "");
  const [salePrice, setSalePrice] = useState(
    item.salePrice != null ? String(item.salePrice) : "",
  );
  const [qty, setQty] = useState(String(item.stock));
  const [adjustKind, setAdjustKind] = useState<"correccion" | "ajuste">("correccion");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();

  const diff = (Number(qty) || 0) - item.stock;
  const stockCambio = Math.abs(diff) > 0.0001;

  const guardar = () => {
    setMsg(null);
    if (!name.trim()) return setMsg("El nombre no puede quedar vacío.");
    if (item.sellable && Number(salePrice) <= 0) return setMsg("Indica el precio de venta.");
    if (stockCambio && !reason.trim()) return setMsg("Indica el motivo del ajuste de stock.");
    if (pin.length < 4) return setMsg("Ingresa el PIN de administradora.");
    start(async () => {
      const r = await editarProductoInventario({
        ingredientId: item.id,
        name: name.trim(),
        unitCost: Number(cost) || 0,
        salePrice: item.sellable ? Number(salePrice) || 0 : null,
        newQty: stockCambio ? Number(qty) || 0 : null,
        adjustKind,
        reason: stockCambio ? reason.trim() : null,
        pin,
      });
      if (r.error) setMsg(r.error);
      else onClose();
    });
  };

  const eliminar = () => {
    setMsg(null);
    if (pin.length < 4) return setMsg("Ingresa el PIN para eliminar.");
    start(async () => {
      const r = await eliminarProductoInventario({ ingredientId: item.id, pin });
      // Si tiene historial, el action devuelve aviso pero igual lo desactivó.
      if (r.error && !r.error.includes("desactiv")) setMsg(r.error);
      else onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-5">
        <p className="text-lg font-bold">Editar producto</p>
        <p className="mb-3 text-xs opacity-50">
          Cambia los datos y confirma con tu PIN. Stock actual: {item.stock}.
        </p>
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium opacity-60">Nombre</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />

          <label className="text-xs font-medium opacity-60">Costo unitario $</label>
          <input
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            inputMode="decimal"
            className={inputCls}
          />

          {item.sellable ? (
            <>
              <label className="text-xs font-medium opacity-60">Precio de venta $</label>
              <input
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                inputMode="decimal"
                className={inputCls}
              />
            </>
          ) : (
            <p className="text-xs opacity-50">
              No es un producto vendible. Si quieres venderlo, elimínalo y créalo de nuevo
              marcando “se vende”.
            </p>
          )}

          <div className="mt-1 rounded-2xl bg-ink/[0.03] p-3">
            <label className="text-xs font-medium opacity-60">Ajustar stock (conteo real)</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className={inputCls}
              />
              <span className={`text-sm font-semibold ${stockCambio ? "text-coral" : "opacity-40"}`}>
                {diff > 0 ? `+${diff}` : diff}
              </span>
            </div>
            {stockCambio && (
              <div className="mt-2 flex flex-col gap-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => setAdjustKind("correccion")}
                    className={`flex-1 rounded-full px-3 py-2 text-xs font-semibold ${
                      adjustKind === "correccion" ? "bg-ink text-white" : "bg-ink/10"
                    }`}
                  >
                    Corrección de dato
                  </button>
                  <button
                    onClick={() => setAdjustKind("ajuste")}
                    className={`flex-1 rounded-full px-3 py-2 text-xs font-semibold ${
                      adjustKind === "ajuste" ? "bg-coral text-white" : "bg-ink/10"
                    }`}
                  >
                    Conteo físico
                  </button>
                </div>
                <p className="text-[11px] opacity-50">
                  {adjustKind === "correccion"
                    ? "Arreglas un error de dato. No cuenta como desfase/robo."
                    : "Contaste físico y no cuadra. Cuenta como posible robo en la analítica."}
                </p>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className={inputCls}
                  placeholder="Motivo (ej. error al cargar / faltante)"
                />
              </div>
            )}
          </div>

          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className={inputCls}
            placeholder="PIN de administradora"
          />

          <div className="mt-1 flex gap-2">
            <button
              onClick={guardar}
              disabled={pending}
              className="flex-1 rounded-full bg-ink py-3 font-semibold text-white"
            >
              {pending ? "Guardando…" : "Guardar cambios"}
            </button>
            <button
              onClick={onClose}
              className="rounded-full border border-ink/15 px-5 py-3 font-semibold"
            >
              Cancelar
            </button>
          </div>
          {msg && <p className="text-center text-sm text-coral">{msg}</p>}

          {confirmDelete ? (
            <div className="mt-2 rounded-2xl bg-coral/10 p-3 text-center">
              <p className="text-sm font-semibold text-coral">
                ¿Eliminar “{item.name}”? (necesita PIN)
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={eliminar}
                  disabled={pending}
                  className="flex-1 rounded-full bg-coral py-2 text-sm font-semibold text-white"
                >
                  Sí, eliminar
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-full border border-ink/15 px-4 py-2 text-sm font-semibold"
                >
                  No
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="mt-2 text-center text-sm font-semibold text-coral"
            >
              Eliminar producto
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

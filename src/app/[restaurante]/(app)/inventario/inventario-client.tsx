"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageTitle } from "@/components/ui";
import { Switch } from "@/components/ui/switch";
import AddModal from "@/components/agregar-producto-modal";
import {
  editarProductoInventario,
  eliminarProductoInventario,
  toggleConsumoVisible,
} from "../admin/actions";

interface Product {
  id: string;
  name: string;
  kind: "contable" | "granel";
  unit: string | null;
  cost: number;
  stock: number | null;
  sellable: boolean;
  salePrice: number | null;
  consumoVisible: boolean;
}

const inputCls =
  "w-full rounded-xl border border-ink/15 px-3 py-2.5 text-base outline-none focus:border-ink/40";

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

export default function InventarioClient({ products }: { products: Product[] }) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [, start] = useTransition();

  const onToggleConsumo = (id: string, visible: boolean) =>
    start(async () => {
      await toggleConsumoVisible({ ingredientId: id, visible });
      router.refresh();
    });

  const q = search.trim().toLowerCase();
  const visibles = q
    ? products.filter((p) => p.name.toLowerCase().includes(q))
    : products;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <PageTitle title="Inventario" />
        <button
          onClick={() => setShowAdd(true)}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-ink text-2xl font-bold text-white"
          aria-label="Agregar producto"
        >
          +
        </button>
      </div>

      {products.length > 0 && (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar producto…"
          className="w-full rounded-2xl border border-ink/15 bg-white px-4 py-3 text-lg outline-none focus:border-ink/40"
        />
      )}

      <ProductTable
        title="Para cocinar"
        hint="se usa en las recetas / consumo"
        products={visibles.filter((p) => !p.sellable)}
        onEdit={setEditing}
        onToggleConsumo={onToggleConsumo}
        showConsumo
      />
      <ProductTable
        title="De venta"
        hint="se vende directo al cliente"
        products={visibles.filter((p) => p.sellable)}
        onEdit={setEditing}
        showSale
      />

      {products.length === 0 && (
        <p className="rounded-2xl bg-ink/[0.03] px-4 py-8 text-center text-sm opacity-50">
          Sin productos. Toca + para agregar.
        </p>
      )}
      {q && visibles.length === 0 && (
        <p className="rounded-2xl bg-ink/[0.03] px-4 py-6 text-center text-sm opacity-60">
          No encuentro “{search}”. Toca + para crearlo.
        </p>
      )}
      <p className="text-center text-xs opacity-50">
        Toca un producto para editarlo o ajustar su stock (requiere PIN de admin). El botón
        «consumo» decide si la cocinera puede registrarlo en su gasto del día.
      </p>

      {showAdd && <AddModal onClose={() => setShowAdd(false)} />}
      {editing && (
        <EditModal
          item={products.find((p) => p.id === editing)!}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ProductTable({
  title,
  hint,
  products,
  onEdit,
  onToggleConsumo,
  showSale,
  showConsumo,
}: {
  title: string;
  hint: string;
  products: Product[];
  onEdit: (id: string) => void;
  onToggleConsumo?: (id: string, visible: boolean) => void;
  showSale?: boolean;
  showConsumo?: boolean;
}) {
  // Valor del inventario = suma de (stock × costo unitario) de cada producto.
  const totalInventario = products.reduce(
    (s, p) => s + (p.stock ?? 0) * p.cost,
    0,
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-base font-bold">
          {title} <span className="opacity-50">· {products.length}</span>
        </p>
        <p className="text-xs opacity-60">{hint}</p>
      </div>
      <div className="overflow-hidden rounded-3xl border border-ink/10">
        {products.map((p) => {
          const totalCost = (p.stock ?? 0) * p.cost;
          return (
            <div
              key={p.id}
              className="flex items-center gap-3 border-t border-ink/5 px-4 py-3 first:border-t-0"
            >
              <button
                onClick={() => onEdit(p.id)}
                className="flex min-w-0 flex-1 flex-col text-left"
              >
                <span className="truncate text-lg font-semibold leading-tight">{p.name}</span>
                <span className="mt-1 text-sm opacity-70">
                  <span className="font-semibold">{p.stock != null ? p.stock : "—"}</span>
                  {p.unit ? ` ${p.unit}` : ""} · {money(p.cost)} c/u
                </span>
                {showConsumo && (
                  <span className="text-sm opacity-70">
                    {p.consumoVisible ? "la cocinera registra" : "baja al vender"}
                  </span>
                )}
                {showSale && p.salePrice != null && (
                  <span className="text-sm opacity-70">vende {money(p.salePrice)}</span>
                )}
              </button>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="text-base font-bold">{money(totalCost)}</span>
                {showConsumo && (
                  <button
                    onClick={() => onToggleConsumo?.(p.id, !p.consumoVisible)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      p.consumoVisible ? "bg-mint text-ink" : "bg-ink/5 opacity-60"
                    }`}
                  >
                    {p.consumoVisible ? "Consumo ✓" : "Consumo"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {products.length === 0 ? (
          <p className="px-4 py-5 text-center text-sm opacity-50">Nada aquí todavía.</p>
        ) : (
          <div className="flex items-center justify-between border-t border-ink/10 bg-ink/[0.03] px-4 py-3">
            <span className="text-sm font-semibold opacity-70">Total en inventario</span>
            <span className="text-lg font-bold">{money(totalInventario)}</span>
          </div>
        )}
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
  const [consumo, setConsumo] = useState(item.consumoVisible);
  const [qty, setQty] = useState(item.stock != null ? String(item.stock) : "");
  const [adjustKind, setAdjustKind] = useState<"correccion" | "ajuste">("correccion");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();

  // El granel no lleva stock por unidades (su costo va al pool).
  const tieneStock = item.stock != null;
  const diff = (Number(qty) || 0) - (item.stock ?? 0);
  const stockCambio = tieneStock && Math.abs(diff) > 0.0001;

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
        consumoVisible:
          !item.sellable && consumo !== item.consumoVisible ? consumo : undefined,
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
      if (r.error && !r.error.includes("desactiv")) setMsg(r.error);
      else onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-5">
        <p className="text-lg font-bold">Editar producto</p>
        <p className="mb-3 text-xs opacity-50">
          Cambia los datos y confirma con tu PIN.{" "}
          {tieneStock ? `Stock actual: ${item.stock}.` : "Insumo a granel (sin stock por unidades)."}
        </p>
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium opacity-60">Nombre</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />

          <label className="text-xs font-medium opacity-60">
            Costo por {item.unit ?? "unidad"} $
          </label>
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
              marcando “de venta”.
            </p>
          )}

          {!item.sellable && (
            <div className="mt-1 flex items-center justify-between gap-3 rounded-2xl bg-ink/[0.03] px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium">¿La cocinera registra cuánto usa?</p>
                <p className="text-[11px] opacity-50">
                  {consumo
                    ? "Sí: ella anota lo que gastó (arroz, tomate, carne)."
                    : "No: se descuenta solo al vender (presa, huevo)."}
                </p>
              </div>
              <Switch checked={consumo} onCheckedChange={(c) => setConsumo(c)} />
            </div>
          )}

          {tieneStock && (
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
          )}

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

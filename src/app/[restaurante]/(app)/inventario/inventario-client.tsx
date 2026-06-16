"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageTitle } from "@/components/ui";
import { Switch } from "@/components/ui/switch";
import {
  agregarProductoInventario,
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
  "w-full rounded-xl border border-ink/15 px-3 py-2 text-sm outline-none focus:border-ink/40";

// Unidades estándar para registrar y consumir (cantidad + unidad).
const UNITS = ["unidad", "libra", "kilo", "gramo", "funda", "litro", "ml"] as const;

export default function InventarioClient({ products }: { products: Product[] }) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [, start] = useTransition();

  const onToggleConsumo = (id: string, visible: boolean) =>
    start(async () => {
      await toggleConsumoVisible({ ingredientId: id, visible });
      router.refresh();
    });

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

      <ProductTable
        title="Para cocinar"
        hint="se usa en las recetas / consumo"
        products={products.filter((p) => !p.sellable)}
        onEdit={setEditing}
        onToggleConsumo={onToggleConsumo}
        showConsumo
      />
      <ProductTable
        title="De venta"
        hint="se vende directo al cliente"
        products={products.filter((p) => p.sellable)}
        onEdit={setEditing}
        showSale
      />

      {products.length === 0 && (
        <p className="rounded-2xl bg-ink/[0.03] px-4 py-8 text-center text-sm opacity-50">
          Sin productos. Toca + para agregar.
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
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide opacity-50">
          {title} · {products.length}
        </p>
        <p className="text-[11px] opacity-40">{hint}</p>
      </div>
      <div className="overflow-hidden rounded-3xl border border-ink/10">
        <div className="flex items-center bg-ink/5 px-4 py-2 text-xs font-semibold opacity-60">
          <span className="flex-1">Producto</span>
          {showSale && <span className="w-16 text-right">Venta</span>}
          <span className="w-14 text-right">Stock</span>
          <span className="w-16 text-right">Costo u.</span>
          {showConsumo && <span className="w-20 text-right">Consumo</span>}
        </div>
        {products.map((p) => (
          <div key={p.id} className="flex items-center border-t border-ink/5 px-4 py-2.5 text-sm">
            <button onClick={() => onEdit(p.id)} className="flex min-w-0 flex-1 flex-col text-left">
              <span className="truncate font-medium">{p.name}</span>
              <span className="text-[11px] opacity-50">
                {p.kind === "granel" ? "granel" : "se cuenta"}
                {p.unit ? ` · ${p.unit}` : ""}
              </span>
            </button>
            {showSale && (
              <span className="w-16 text-right font-semibold text-teal">
                {p.salePrice != null ? `$${p.salePrice.toFixed(2)}` : "—"}
              </span>
            )}
            <span className="w-14 text-right">{p.stock != null ? p.stock : "—"}</span>
            <span className="w-16 text-right opacity-70">${p.cost.toFixed(2)}</span>
            {showConsumo && (
              <span className="w-20 text-right">
                <button
                  onClick={() => onToggleConsumo?.(p.id, !p.consumoVisible)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    p.consumoVisible ? "bg-mint text-ink" : "bg-ink/5 opacity-50"
                  }`}
                >
                  {p.consumoVisible ? "Sí" : "No"}
                </button>
              </span>
            )}
          </div>
        ))}
        {products.length === 0 && (
          <p className="px-4 py-5 text-center text-sm opacity-40">Nada aquí todavía.</p>
        )}
      </div>
    </div>
  );
}

function UnitPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      {UNITS.map((u) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
    </select>
  );
}

function AddModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"cocina" | "venta">("cocina");
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-lg font-bold">Agregar producto</p>
          <button onClick={onClose} className="text-sm font-semibold opacity-50">
            Cerrar
          </button>
        </div>
        <div className="mb-4 flex gap-1 rounded-full bg-ink/5 p-1">
          <button
            onClick={() => setTab("cocina")}
            className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold transition ${
              tab === "cocina" ? "bg-ink text-white" : "opacity-60"
            }`}
          >
            Para cocinar
          </button>
          <button
            onClick={() => setTab("venta")}
            className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold transition ${
              tab === "venta" ? "bg-ink text-white" : "opacity-60"
            }`}
          >
            De venta
          </button>
        </div>
        {tab === "cocina" ? <FormInsumo onDone={onClose} /> : <FormVenta onDone={onClose} />}
      </div>
    </div>
  );
}

// Insumo para cocinar: se cuenta (contable) o a granel (pool). Lleva unidad y costo.
function FormInsumo({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState<"contable" | "granel">("contable");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<string>("unidad");
  const [qty, setQty] = useState("");
  const [total, setTotal] = useState("");
  const [unitCost, setUnitCost] = useState("");
  // Activado por defecto: la cocinera lo ve en consumo; el admin lo desactiva
  // para lo que ya se descuenta por venta (ej. presa de pollo).
  const [consumo, setConsumo] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const q = Number(qty) || 0;
  const t = Number(total) || 0;
  const unitFromLote = q > 0 ? t / q : 0;

  const submit = () => {
    setMsg(null);
    if (!name.trim()) return setMsg("Escribe el nombre.");
    if (kind === "contable" && q <= 0) return setMsg("Indica la cantidad inicial.");
    if (kind === "granel" && !(Number(unitCost) > 0)) return setMsg("Indica el costo por unidad.");
    start(async () => {
      const r = await agregarProductoInventario({
        name: name.trim(),
        kind,
        unit,
        qty: kind === "contable" ? q : null,
        totalCost: kind === "contable" ? t : null,
        unitCost: kind === "granel" ? Number(unitCost) : null,
        salePrice: null,
        consumoVisible: consumo,
      });
      if (r.error) setMsg(r.error);
      else onDone();
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        {(
          [
            ["contable", "Se cuenta"],
            ["granel", "A granel"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setKind(v)}
            className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold ${
              kind === v ? "bg-ink text-white" : "bg-ink/5"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-[11px] opacity-50">
        {kind === "contable"
          ? "Se cuenta en unidades (presa, huevo, unidad). Anti-robo por conteo."
          : "No se cuenta por porción (arroz, sopa, aceite): su costo va al pool del día."}
      </p>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={inputCls}
        placeholder={kind === "contable" ? "Presa de pollo, huevo…" : "Arroz, aceite, sopa…"}
      />

      <label className="text-xs font-medium opacity-60">Unidad</label>
      <UnitPicker value={unit} onChange={setUnit} />

      {kind === "contable" ? (
        <>
          <div className="flex gap-2">
            <input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              inputMode="decimal"
              className={inputCls}
              placeholder={`Cantidad (${unit})`}
            />
            <input
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              inputMode="decimal"
              className={inputCls}
              placeholder="Costo total $"
            />
          </div>
          <p className="text-center text-sm">
            Costo por {unit}: <span className="font-bold">${unitFromLote.toFixed(2)}</span>
          </p>
        </>
      ) : (
        <>
          <label className="text-xs font-medium opacity-60">Costo por {unit} $</label>
          <input
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
            inputMode="decimal"
            className={inputCls}
            placeholder="0.00"
          />
        </>
      )}

      <div className="mt-1 flex items-center justify-between gap-3 rounded-2xl bg-ink/[0.03] px-3 py-2.5">
        <span className="text-sm">La cocinera puede registrarlo en su consumo del día</span>
        <Switch checked={consumo} onCheckedChange={(c) => setConsumo(c)} />
      </div>

      <button
        onClick={submit}
        disabled={pending}
        className="mt-1 rounded-full bg-ink py-3 font-semibold text-white"
      >
        {pending ? "Guardando…" : "Agregar para cocinar"}
      </button>
      {msg && <p className="text-center text-sm text-coral">{msg}</p>}
    </div>
  );
}

// Producto que se VENDE directo (cola, agua…): contable + precio de venta.
function FormVenta({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<string>("unidad");
  const [qty, setQty] = useState("");
  const [total, setTotal] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const q = Number(qty) || 0;
  const t = Number(total) || 0;
  const unitCost = q > 0 ? t / q : 0;
  const sp = Number(salePrice) || 0;

  const submit = () => {
    setMsg(null);
    if (!name.trim() || q <= 0) return setMsg("Completa nombre y cantidad.");
    if (sp <= 0) return setMsg("Indica el precio de venta.");
    start(async () => {
      const r = await agregarProductoInventario({
        name: name.trim(),
        kind: "contable",
        unit,
        qty: q,
        totalCost: t,
        unitCost: null,
        salePrice: sp,
        consumoVisible: false,
      });
      if (r.error) setMsg(r.error);
      else onDone();
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="mb-1 text-xs opacity-50">
        Lo que se vende directo al cliente (cola, agua, jugo…). Se descuenta del stock al venderlo.
      </p>
      <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Nombre (Cola 1 litro, Agua…)" />
      <label className="text-xs font-medium opacity-60">Unidad</label>
      <UnitPicker value={unit} onChange={setUnit} />
      <div className="flex gap-2">
        <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" className={inputCls} placeholder="Cantidad" />
        <input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" className={inputCls} placeholder="Costo total $" />
      </div>
      <p className="text-center text-sm">
        Costo por unidad: <span className="font-bold">${unitCost.toFixed(2)}</span>
      </p>
      <input value={salePrice} onChange={(e) => setSalePrice(e.target.value)} inputMode="decimal" className={inputCls} placeholder="Precio de venta al público $" />
      <button onClick={submit} disabled={pending} className="mt-1 rounded-full bg-ink py-3 font-semibold text-white">
        {pending ? "Guardando…" : "Agregar para venta"}
      </button>
      {msg && <p className="text-center text-sm text-coral">{msg}</p>}
    </div>
  );
}

function EditModal({ item, onClose }: { item: Product; onClose: () => void }) {
  const [name, setName] = useState(item.name);
  const [cost, setCost] = useState(item.cost ? String(item.cost) : "");
  const [salePrice, setSalePrice] = useState(
    item.salePrice != null ? String(item.salePrice) : "",
  );
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

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { agregarProductoInventario } from "@/app/[restaurante]/(app)/admin/actions";

const inputCls =
  "w-full rounded-xl border border-ink/15 px-3 py-2.5 text-base outline-none focus:border-ink/40";

// Unidades estándar para registrar y consumir (cantidad + unidad).
const UNITS = ["unidad", "libra", "kilo", "gramo", "funda", "litro", "ml"] as const;

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

// Cantidad + costo total + costo por unidad, con cálculo en ambos sentidos.
// Pones la cantidad y luego UNO de los dos costos; el otro se calcula solo.
function useCosto() {
  const [qty, setQtyRaw] = useState("");
  const [total, setTotalRaw] = useState("");
  const [unitCost, setUnitRaw] = useState("");
  // Cuál costo fijó el usuario al final (el otro se deriva al cambiar la cantidad).
  const [anchor, setAnchor] = useState<"total" | "unit">("total");

  const num = (s: string) => Number(s) || 0;
  const fmt = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "");

  const setQty = (v: string) => {
    setQtyRaw(v);
    const q = num(v);
    if (q <= 0) return;
    if (anchor === "total" && num(total) > 0) setUnitRaw(fmt(num(total) / q));
    else if (anchor === "unit" && num(unitCost) > 0) setTotalRaw(fmt(num(unitCost) * q));
  };

  const setTotal = (v: string) => {
    setTotalRaw(v);
    setAnchor("total");
    const q = num(qty);
    if (q > 0 && v.trim() !== "") setUnitRaw(fmt(num(v) / q));
  };

  const setUnitCost = (v: string) => {
    setUnitRaw(v);
    setAnchor("unit");
    const q = num(qty);
    if (q > 0 && v.trim() !== "") setTotalRaw(fmt(num(v) * q));
  };

  return {
    qty,
    total,
    unitCost,
    setQty,
    setTotal,
    setUnitCost,
    q: num(qty),
    t: num(total),
  };
}

type Costo = ReturnType<typeof useCosto>;

function CostoFields({ unit, costo }: { unit: string; costo: Costo }) {
  const clean = (v: string) => v.replace(/[^\d.]/g, "");
  return (
    <div className="flex flex-col gap-2">
      <input
        value={costo.qty}
        onChange={(e) => costo.setQty(clean(e.target.value))}
        inputMode="decimal"
        className={inputCls}
        placeholder={`Cantidad (${unit})`}
      />
      <div className="flex gap-2">
        <input
          value={costo.total}
          onChange={(e) => costo.setTotal(clean(e.target.value))}
          inputMode="decimal"
          className={inputCls}
          placeholder="Costo total $"
        />
        <input
          value={costo.unitCost}
          onChange={(e) => costo.setUnitCost(clean(e.target.value))}
          inputMode="decimal"
          className={inputCls}
          placeholder={`Costo por ${unit} $`}
        />
      </div>
      <p className="text-center text-xs opacity-60">
        Pon la cantidad y luego el costo total <b>o</b> el costo por {unit}: el otro se calcula
        solo.
      </p>
    </div>
  );
}

/**
 * Modal para crear un producto nuevo (insumo de cocina o producto de venta).
 * Reutilizado por el inventario del admin y por el módulo de registrar compras.
 * `onCreated` se llama con el nombre cuando se crea con éxito (además de cerrar).
 */
export default function AddModal({
  onClose,
  onCreated,
  defaultName,
}: {
  onClose: () => void;
  onCreated?: (name: string) => void;
  defaultName?: string;
}) {
  const [tab, setTab] = useState<"cocina" | "venta">("cocina");
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-4 sm:items-center">
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
        {tab === "cocina" ? (
          <FormInsumo defaultName={defaultName} onDone={onClose} onCreated={onCreated} />
        ) : (
          <FormVenta defaultName={defaultName} onDone={onClose} onCreated={onCreated} />
        )}
      </div>
    </div>
  );
}

// Insumo para cocinar: nombre + unidad. El stock inicial (cantidad + costo) es
// opcional vía switch; si no, el producto se crea sin stock y entra luego con
// una compra/gasto.
function FormInsumo({
  onDone,
  onCreated,
  defaultName,
}: {
  onDone: () => void;
  onCreated?: (name: string) => void;
  defaultName?: string;
}) {
  const [name, setName] = useState(defaultName ?? "");
  const [unit, setUnit] = useState<string>("unidad");
  const [registrarInicial, setRegistrarInicial] = useState(false);
  const costo = useCosto();
  // Activado por defecto: la cocinera lo registra (arroz, tomate, carne). El
  // admin lo apaga para lo que se descuenta solo al vender (presa, huevo).
  const [consumo, setConsumo] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    setMsg(null);
    if (!name.trim()) return setMsg("Escribe el nombre.");
    if (registrarInicial && costo.q <= 0) return setMsg("Indica la cantidad que tienes.");
    start(async () => {
      const r = await agregarProductoInventario({
        name: name.trim(),
        kind: consumo ? "granel" : "contable",
        unit,
        qty: registrarInicial ? costo.q : null,
        totalCost: registrarInicial ? costo.t : null,
        salePrice: null,
        consumoVisible: consumo,
        registrarInicial,
      });
      if (r.error) setMsg(r.error);
      else {
        onCreated?.(name.trim());
        onDone();
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs opacity-60">
        Lo que usas para cocinar. Crea el producto con su nombre y unidad; el stock lo registras
        ahora o luego desde una compra.
      </p>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={inputCls}
        placeholder="Arroz, presa de pollo, tomate…"
      />

      <label className="text-sm font-medium opacity-70">Unidad</label>
      <UnitPicker value={unit} onChange={setUnit} />

      <div className="mt-1 flex items-center justify-between gap-3 rounded-2xl bg-ink/[0.03] px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-medium">Registrar inventario inicial</p>
          <p className="text-xs opacity-60">
            {registrarInicial
              ? "Pondrás cuánto tienes ahora y cuánto costó."
              : "Solo crea el producto. El stock entra luego con una compra."}
          </p>
        </div>
        <Switch checked={registrarInicial} onCheckedChange={setRegistrarInicial} />
      </div>

      {registrarInicial && <CostoFields unit={unit} costo={costo} />}

      <div className="mt-1 flex items-center justify-between gap-3 rounded-2xl bg-ink/[0.03] px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-medium">¿La cocinera registra cuánto usa?</p>
          <p className="text-xs opacity-60">
            {consumo
              ? "Sí: ella anota lo que gastó (arroz, tomate, carne)."
              : "No: se descuenta solo al vender (presa, huevo)."}
          </p>
        </div>
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

// Producto que se VENDE directo (cola, agua…): contable + precio de venta. El
// stock inicial es opcional vía switch.
function FormVenta({
  onDone,
  onCreated,
  defaultName,
}: {
  onDone: () => void;
  onCreated?: (name: string) => void;
  defaultName?: string;
}) {
  const [name, setName] = useState(defaultName ?? "");
  const [unit, setUnit] = useState<string>("unidad");
  const [registrarInicial, setRegistrarInicial] = useState(false);
  const costo = useCosto();
  const [salePrice, setSalePrice] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const sp = Number(salePrice) || 0;

  const submit = () => {
    setMsg(null);
    if (!name.trim()) return setMsg("Escribe el nombre.");
    if (sp <= 0) return setMsg("Indica el precio de venta.");
    if (registrarInicial && costo.q <= 0) return setMsg("Indica la cantidad que tienes.");
    start(async () => {
      const r = await agregarProductoInventario({
        name: name.trim(),
        kind: "contable",
        unit,
        qty: registrarInicial ? costo.q : null,
        totalCost: registrarInicial ? costo.t : null,
        salePrice: sp,
        consumoVisible: false,
        registrarInicial,
      });
      if (r.error) setMsg(r.error);
      else {
        onCreated?.(name.trim());
        onDone();
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="mb-1 text-xs opacity-60">
        Lo que se vende directo al cliente (cola, agua, jugo…). Se descuenta del stock al venderlo.
      </p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className={inputCls}
        placeholder="Nombre (Cola 1 litro, Agua…)"
      />
      <label className="text-sm font-medium opacity-70">Unidad</label>
      <UnitPicker value={unit} onChange={setUnit} />
      <input
        value={salePrice}
        onChange={(e) => setSalePrice(e.target.value.replace(/[^\d.]/g, ""))}
        inputMode="decimal"
        className={inputCls}
        placeholder="Precio de venta al público $"
      />

      <div className="mt-1 flex items-center justify-between gap-3 rounded-2xl bg-ink/[0.03] px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-medium">Registrar inventario inicial</p>
          <p className="text-xs opacity-60">
            {registrarInicial
              ? "Pondrás cuánto tienes ahora y cuánto costó."
              : "Solo crea el producto. El stock entra luego con una compra."}
          </p>
        </div>
        <Switch checked={registrarInicial} onCheckedChange={setRegistrarInicial} />
      </div>

      {registrarInicial && <CostoFields unit={unit} costo={costo} />}

      <button
        onClick={submit}
        disabled={pending}
        className="mt-1 rounded-full bg-ink py-3 font-semibold text-white"
      >
        {pending ? "Guardando…" : "Agregar para venta"}
      </button>
      {msg && <p className="text-center text-sm text-coral">{msg}</p>}
    </div>
  );
}

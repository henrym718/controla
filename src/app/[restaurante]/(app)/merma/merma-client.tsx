"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, PageTitle } from "@/components/ui";
import { registrarMermaInsumosAction } from "../admin/actions";

interface Product {
  id: string;
  name: string;
  kind: "contable" | "granel";
  unit: string | null;
  cost: number;
  stock: number;
  sellable: boolean;
}

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
const inputCls =
  "w-full rounded-xl border border-ink/15 px-3 py-2 text-sm outline-none focus:border-ink/40";

export default function MermaClient({
  date,
  products,
}: {
  slug: string;
  date: string;
  products: Product[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const costById = useMemo(() => new Map(products.map((p) => [p.id, p.cost])), [products]);
  const nameById = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products]);

  // Productos con cantidad marcada (lo que se va a dar de baja).
  const seleccion = useMemo(
    () =>
      Object.entries(qty)
        .map(([id, v]) => ({ id, qty: Number(v) || 0 }))
        .filter((x) => x.qty > 0),
    [qty],
  );
  const totalPerdida = seleccion.reduce((s, x) => s + x.qty * (costById.get(x.id) ?? 0), 0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, query]);

  function registrar() {
    setMsg(null);
    setOk(null);
    if (seleccion.length === 0) return setMsg("Marca cuánto se dañó de al menos un producto.");
    const items = seleccion.map((x) => ({
      ingredientId: x.id,
      qty: x.qty,
      reason: reason.trim() || null,
    }));
    start(async () => {
      const r = await registrarMermaInsumosAction(date, items);
      if (r.error) {
        setMsg(r.error);
        return;
      }
      const nombres = seleccion.map((x) => `${x.qty} × ${nameById.get(x.id) ?? "?"}`).join(", ");
      setOk(`Diste de baja ${nombres}. Pérdida registrada: ${money(Number(r.total ?? 0))}.`);
      setQty({});
      setReason("");
      setQuery("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Registrar daño" subtitle="Da de baja lo que se dañó o se perdió" />

      <Card className="bg-coral/10 p-4 text-sm">
        <p>
          Cuando un producto se <b>daña o se pierde</b> (un tomate podrido, una cola rota, una
          presa que ya no sirve para mañana), márcalo aquí. Baja del inventario y se registra como{" "}
          <b>merma</b> (pérdida).
        </p>
        <p className="mt-2 text-[12px] opacity-70">
          No toca la caja del turno (el producto ya estaba comprado) y queda firmado a tu nombre en
          la bitácora. Solo el admin puede dar de baja productos.
        </p>
      </Card>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className={inputCls}
        placeholder="Buscar producto…"
      />

      {/* Resumen de la pérdida marcada */}
      <div
        className={`rounded-3xl p-4 text-center text-white ${
          totalPerdida > 0.005 ? "bg-coral" : "bg-ink"
        }`}
      >
        <p className="text-xs text-white/70">
          {seleccion.length > 0
            ? `${seleccion.length} producto(s) por dar de baja`
            : "Nada marcado todavía"}
        </p>
        <p className="text-2xl font-bold">{money(totalPerdida)}</p>
      </div>

      {/* Lista de productos del inventario */}
      <Card className="p-0">
        <div className="flex items-center bg-ink/5 px-4 py-2 text-xs font-semibold opacity-60">
          <span className="flex-1">Producto</span>
          <span className="w-14 text-right">Stock</span>
          <span className="w-24 text-right">Se dañó</span>
        </div>
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm opacity-40">No hay productos.</p>
        ) : (
          filtered.map((p) => {
            const v = qty[p.id] ?? "";
            const active = Number(v) > 0;
            return (
              <div
                key={p.id}
                className="flex items-center border-t border-ink/5 px-4 py-2.5 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className={`truncate font-medium ${active ? "text-coral" : ""}`}>{p.name}</p>
                  <p className="text-[11px] opacity-50">
                    {p.unit ?? "unidad"} · {money(p.cost)} c/u
                  </p>
                </div>
                <span className="w-14 text-right opacity-60">{p.stock}</span>
                <input
                  inputMode="decimal"
                  value={v}
                  onChange={(e) =>
                    setQty((m) => ({ ...m, [p.id]: e.target.value.replace(/[^\d.]/g, "") }))
                  }
                  placeholder="0"
                  className="ml-2 w-20 rounded-xl border border-ink/15 px-2 py-1.5 text-right outline-none focus:border-ink/40"
                />
              </div>
            );
          })
        )}
      </Card>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium opacity-60">Motivo (opcional)</label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={inputCls}
          placeholder="Ej. se dañó en la nevera, se pudrió, se rompió…"
        />
      </div>

      <Button variant="accent" onClick={registrar} disabled={pending || seleccion.length === 0}>
        {pending ? "Registrando…" : "Dar de baja y registrar merma"}
      </Button>

      {ok && (
        <div className="rounded-2xl bg-mint p-3 text-center text-sm font-medium">{ok}</div>
      )}
      {msg && <p className="text-center text-sm text-coral">{msg}</p>}
    </div>
  );
}

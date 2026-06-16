import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDate } from "@/lib/shifts";
import { menuShiftIds, dedupeMenu } from "@/lib/menu";
import VenderClient, { type SellItem, type CuentaLine } from "./vender-client";

interface CuentaItemRow {
  kind: "plato" | "producto";
  ref_id: string;
  name: string;
  unit_price: number;
  qty: number;
}

const cuentaLineKey = (kind: string, refId: string) =>
  `${kind === "plato" ? "plato" : "prod"}:${refId}`;

export default async function VenderPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurante: string }>;
  searchParams: Promise<{ cuenta?: string }>;
}) {
  const { restaurante } = await params;
  const { cuenta: cuentaId } = await searchParams;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);

  const db = createAdminClient();
  // El menú efectivo del turno = lo de ESTE turno + lo de "Todo el día".
  const shiftIds = await menuShiftIds(db, session.restaurant_id, session.shift_id);
  const [
    { data: menu },
    { data: adicionales },
    { data: productos },
    { data: clientes },
    { data: cuentas },
  ] = await Promise.all([
    db
      .from("daily_menu")
      .select("dish_id,shift_id,available,sort_order,dishes(id,name,price,is_combo,is_extra,active)")
      .eq("restaurant_id", session.restaurant_id)
      .eq("business_date", businessDate())
      .in("shift_id", shiftIds)
      .order("sort_order"),
    db
      .from("dishes")
      .select("id,name,price")
      .eq("restaurant_id", session.restaurant_id)
      .eq("is_extra", true)
      .eq("active", true)
      .order("name"),
    db
      .from("ingredients")
      .select("id,name,sale_price")
      .eq("restaurant_id", session.restaurant_id)
      .eq("is_sellable", true)
      .eq("active", true)
      .order("name"),
    db
      .from("clientes")
      .select("id,name,kind")
      .eq("restaurant_id", session.restaurant_id)
      .eq("active", true)
      .order("name"),
    db
      .from("cuentas_mesa")
      .select("id,label,total,items")
      .eq("restaurant_id", session.restaurant_id)
      .eq("status", "abierta")
      .order("created_at"),
  ]);

  type Dish = {
    id: string;
    name: string;
    price: number;
    is_combo: boolean;
    is_extra: boolean;
    active: boolean;
  };
  type MenuRow = {
    dish_id: string;
    shift_id: string;
    available: boolean;
    dishes: Dish | null;
  };

  const principales: SellItem[] = dedupeMenu(
    (menu ?? []) as unknown as MenuRow[],
    session.shift_id,
  )
    .filter((m) => m.available && m.dishes && m.dishes.active && !m.dishes.is_extra)
    .map((m) => ({
      key: `plato:${m.dishes!.id}`,
      kind: "plato",
      id: m.dishes!.id,
      name: m.dishes!.name,
      price: Number(m.dishes!.price),
      isCombo: m.dishes!.is_combo,
    }));

  const extrasAdicional: SellItem[] = (adicionales ?? []).map((d) => ({
    key: `plato:${d.id}`,
    kind: "plato",
    id: d.id,
    name: d.name,
    price: Number(d.price),
  }));

  const extrasProducto: SellItem[] = (productos ?? [])
    .filter((p) => Number(p.sale_price ?? 0) > 0)
    .map((p) => ({
      key: `prod:${p.id}`,
      kind: "producto",
      id: p.id,
      name: p.name,
      price: Number(p.sale_price),
    }));

  const clientesList = (clientes ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind === "empleado" ? ("empleado" as const) : ("cliente" as const),
  }));

  const cuentasAbiertas = (cuentas ?? []).map((c) => {
    const items = (c.items as unknown as CuentaItemRow[]) ?? [];
    return {
      id: c.id,
      label: c.label,
      total: Number(c.total),
      count: items.reduce((s, i) => s + Number(i.qty), 0),
    };
  });

  let cuenta: { id: string; label: string; lines: CuentaLine[] } | null = null;
  if (cuentaId) {
    const c = (cuentas ?? []).find((x) => x.id === cuentaId);
    if (c) {
      const items = (c.items as unknown as CuentaItemRow[]) ?? [];
      cuenta = {
        id: c.id,
        label: c.label,
        lines: items.map((i) => ({
          key: cuentaLineKey(i.kind, i.ref_id),
          kind: i.kind === "producto" ? "producto" : "plato",
          id: i.ref_id,
          name: i.name,
          price: Number(i.unit_price),
          qty: Number(i.qty),
        })),
      };
    }
  }

  return (
    <VenderClient
      slug={restaurante}
      principales={principales}
      extras={[...extrasAdicional, ...extrasProducto]}
      clientes={clientesList}
      cuentasAbiertas={cuentasAbiertas}
      cuenta={cuenta}
    />
  );
}

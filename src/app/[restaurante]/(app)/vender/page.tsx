import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDate } from "@/lib/shifts";
import VenderClient, { type SellItem } from "./vender-client";

export default async function VenderPage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);

  const db = createAdminClient();
  const [{ data: menu }, { data: adicionales }, { data: productos }] = await Promise.all([
    // Platos y combos del MENÚ del día (qué se vende hoy en este turno).
    db
      .from("daily_menu")
      .select("dish_id,sort_order,dishes(id,name,price,is_combo,is_extra,active)")
      .eq("restaurant_id", session.restaurant_id)
      .eq("business_date", businessDate())
      .eq("shift_id", session.shift_id)
      .eq("available", true)
      .order("sort_order"),
    // TODOS los adicionales activos del catálogo (siempre disponibles en la venta).
    db
      .from("dishes")
      .select("id,name,price")
      .eq("restaurant_id", session.restaurant_id)
      .eq("is_extra", true)
      .eq("active", true)
      .order("name"),
    // TODOS los productos vendibles del inventario (colas, aguas) activos.
    db
      .from("ingredients")
      .select("id,name,sale_price")
      .eq("restaurant_id", session.restaurant_id)
      .eq("is_sellable", true)
      .eq("active", true)
      .order("name"),
  ]);

  type Dish = {
    id: string;
    name: string;
    price: number;
    is_combo: boolean;
    is_extra: boolean;
    active: boolean;
  };
  type MenuRow = { dish_id: string; dishes: Dish | null };

  // Platos y combos = tarjetas grandes (lo principal). Precio del catálogo (lo fija la admin).
  const principales: SellItem[] = ((menu ?? []) as unknown as MenuRow[])
    .filter((m) => m.dishes && m.dishes.active && !m.dishes.is_extra)
    .map((m) => ({
      key: `plato:${m.dishes!.id}`,
      kind: "plato",
      id: m.dishes!.id,
      name: m.dishes!.name,
      price: Number(m.dishes!.price),
      isCombo: m.dishes!.is_combo,
    }));

  // Cajón (siempre presente, colapsado): adicionales del catálogo + productos vendibles.
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

  return (
    <VenderClient
      slug={restaurante}
      principales={principales}
      extras={[...extrasAdicional, ...extrasProducto]}
    />
  );
}

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
  const [{ data: menu }, { data: productos }] = await Promise.all([
    db
      .from("daily_menu")
      .select("dish_id,price,sort_order,dishes(id,name,is_combo,is_extra,category,active)")
      .eq("restaurant_id", session.restaurant_id)
      .eq("business_date", businessDate())
      .eq("shift_id", session.shift_id)
      .eq("available", true)
      .order("sort_order"),
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
    is_combo: boolean;
    is_extra: boolean;
    category: string | null;
    active: boolean;
  };
  type MenuRow = { dish_id: string; price: number; dishes: Dish | null };

  // El menú trae el plato activo + su precio confirmado del día.
  const rows = ((menu ?? []) as unknown as MenuRow[]).filter(
    (m) => m.dishes && m.dishes.active,
  );

  // Platos y combos = tarjetas grandes (lo principal). Sopas antes que combos.
  const principales: SellItem[] = rows
    .filter((m) => !m.dishes!.is_extra)
    .map((m) => ({
      key: `plato:${m.dishes!.id}`,
      kind: "plato",
      id: m.dishes!.id,
      name: m.dishes!.name,
      price: Number(m.price),
      isCombo: m.dishes!.is_combo,
    }));

  // Adicionales del menú + productos vendibles del inventario (colas, aguas) → cajón.
  const extrasMenu: SellItem[] = rows
    .filter((m) => m.dishes!.is_extra)
    .map((m) => ({
      key: `plato:${m.dishes!.id}`,
      kind: "plato",
      id: m.dishes!.id,
      name: m.dishes!.name,
      price: Number(m.price),
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
      extras={[...extrasMenu, ...extrasProducto]}
    />
  );
}

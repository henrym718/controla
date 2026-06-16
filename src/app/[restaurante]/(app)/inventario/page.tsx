import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import InventarioClient from "./inventario-client";

export default async function InventarioPage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);
  if (session.user_role !== "admin") redirect(`/${restaurante}/hoy`);

  const db = createAdminClient();
  const [{ data: ings }, { data: stock }] = await Promise.all([
    db
      .from("ingredients")
      .select("id,name,kind,consumption_unit,consumo_visible,last_unit_cost,is_sellable,sale_price")
      .eq("restaurant_id", session.restaurant_id)
      .eq("active", true)
      .order("name"),
    // Stock de TODOS los insumos (contable + granel).
    db
      .from("v_stock_total")
      .select("ingredient_id,stock")
      .eq("restaurant_id", session.restaurant_id),
  ]);

  const stockMap = new Map(
    (stock ?? []).map((s) => [s.ingredient_id, Number(s.stock ?? 0)]),
  );

  return (
    <InventarioClient
      products={(ings ?? []).map((i) => ({
        id: i.id,
        name: i.name,
        kind: i.kind === "granel" ? ("granel" as const) : ("contable" as const),
        unit: i.consumption_unit ?? null,
        cost: Number(i.last_unit_cost ?? 0),
        stock: stockMap.get(i.id) ?? 0,
        sellable: !!i.is_sellable,
        salePrice: i.sale_price != null ? Number(i.sale_price) : null,
        consumoVisible: !!i.consumo_visible,
      }))}
    />
  );
}

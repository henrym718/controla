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
      .select("id,name,last_unit_cost,is_sellable,sale_price")
      .eq("restaurant_id", session.restaurant_id)
      .eq("kind", "contable")
      .eq("active", true)
      .order("name"),
    db
      .from("v_stock_contable")
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
        cost: Number(i.last_unit_cost ?? 0),
        stock: stockMap.get(i.id) ?? 0,
        sellable: !!i.is_sellable,
        salePrice: i.sale_price != null ? Number(i.sale_price) : null,
      }))}
    />
  );
}

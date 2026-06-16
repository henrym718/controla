import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import ComprasClient, { type Producto } from "./compras-client";

export default async function ComprasPage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);

  const db = createAdminClient();
  const [{ data: ings }, { data: stock }] = await Promise.all([
    db
      .from("ingredients")
      .select("id,name,kind,consumption_unit,is_sellable")
      .eq("restaurant_id", session.restaurant_id)
      .eq("active", true)
      .order("name"),
    db
      .from("v_stock_total")
      .select("ingredient_id,stock")
      .eq("restaurant_id", session.restaurant_id),
  ]);

  const stockMap = new Map(
    (stock ?? []).map((s) => [s.ingredient_id, Number(s.stock ?? 0)]),
  );

  const productos: Producto[] = (ings ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    unit: i.consumption_unit ?? null,
    stock: stockMap.get(i.id) ?? 0,
    sellable: !!i.is_sellable,
  }));

  return <ComprasClient slug={restaurante} productos={productos} />;
}

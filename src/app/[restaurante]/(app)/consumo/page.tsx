import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import ConsumoClient, { type Insumo } from "./consumo-client";

export default async function ConsumoPage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);

  const db = createAdminClient();
  // Insumos que el admin marcó visibles para consumo (no los que se descuentan
  // solos por venta, ni los productos vendibles) + su stock actual.
  const [{ data: ings }, { data: stock }] = await Promise.all([
    db
      .from("ingredients")
      .select("id,name,kind,consumption_unit")
      .eq("restaurant_id", session.restaurant_id)
      .eq("active", true)
      .eq("consumo_visible", true)
      .eq("is_sellable", false)
      .order("name"),
    db
      .from("v_stock_total")
      .select("ingredient_id,stock")
      .eq("restaurant_id", session.restaurant_id),
  ]);

  const stockMap = new Map(
    (stock ?? []).map((s) => [s.ingredient_id, Number(s.stock ?? 0)]),
  );

  const insumos: Insumo[] = (ings ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    kind: i.kind === "granel" ? "granel" : "contable",
    unit: i.consumption_unit ?? null,
    stock: stockMap.get(i.id) ?? 0,
  }));

  return <ConsumoClient slug={restaurante} insumos={insumos} />;
}

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDate } from "@/lib/shifts";
import MermaClient from "./merma-client";

export default async function MermaPage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);
  // Solo el admin puede dar de baja productos (la empleada no).
  if (session.user_role !== "admin") redirect(`/${restaurante}/hoy`);

  const db = createAdminClient();
  const [{ data: ings }, { data: stock }] = await Promise.all([
    db
      .from("ingredients")
      .select("id,name,kind,consumption_unit,last_unit_cost,is_sellable")
      .eq("restaurant_id", session.restaurant_id)
      .eq("active", true)
      .order("name"),
    db
      .from("v_stock_total")
      .select("ingredient_id,stock")
      .eq("restaurant_id", session.restaurant_id),
  ]);

  const stockMap = new Map((stock ?? []).map((s) => [s.ingredient_id, Number(s.stock ?? 0)]));

  const products = (ings ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    kind: i.kind === "granel" ? ("granel" as const) : ("contable" as const),
    unit: i.consumption_unit ?? null,
    cost: Number(i.last_unit_cost ?? 0),
    stock: stockMap.get(i.id) ?? 0,
    sellable: !!i.is_sellable,
  }));

  return <MermaClient slug={restaurante} date={businessDate()} products={products} />;
}

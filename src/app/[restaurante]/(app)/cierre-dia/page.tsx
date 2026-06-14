import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDate } from "@/lib/shifts";
import CierreDiaClient from "./cierre-dia-client";

export default async function CierreDiaPage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);

  const db = createAdminClient();
  const { data: pools } = await db
    .from("v_pool_granel")
    .select("ingredient_id,name,pool_cost")
    .eq("restaurant_id", session.restaurant_id)
    .eq("business_date", businessDate());

  return (
    <CierreDiaClient
      pools={(pools ?? []).map((p) => ({
        ingredientId: p.ingredient_id ?? "",
        name: p.name ?? "",
        poolCost: Number(p.pool_cost ?? 0),
      }))}
    />
  );
}

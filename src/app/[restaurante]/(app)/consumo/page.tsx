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
  // solos por venta, ni los productos vendibles).
  const { data: ings } = await db
    .from("ingredients")
    .select("id,name,kind,consumption_unit")
    .eq("restaurant_id", session.restaurant_id)
    .eq("active", true)
    .eq("consumo_visible", true)
    .eq("is_sellable", false)
    .order("name");

  const insumos: Insumo[] = (ings ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    kind: i.kind === "granel" ? "granel" : "contable",
    unit: i.consumption_unit ?? null,
  }));

  return <ConsumoClient slug={restaurante} insumos={insumos} />;
}

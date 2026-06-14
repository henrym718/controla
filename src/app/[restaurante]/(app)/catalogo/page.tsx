import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import CatalogoClient from "./catalogo-client";

export default async function CatalogoPage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);
  if (session.user_role !== "admin") redirect(`/${restaurante}/hoy`);

  const db = createAdminClient();
  const { data: dishes } = await db
    .from("dishes")
    .select("id,name,price,active")
    .eq("restaurant_id", session.restaurant_id)
    .order("name");

  return (
    <CatalogoClient
      slug={restaurante}
      dishes={(dishes ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        price: Number(d.price),
        active: d.active,
      }))}
    />
  );
}

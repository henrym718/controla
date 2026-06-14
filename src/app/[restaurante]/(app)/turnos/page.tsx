import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import TurnosClient from "./turnos-client";

export default async function TurnosPage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);
  if (session.user_role !== "admin") redirect(`/${restaurante}/hoy`);

  const db = createAdminClient();
  const { data: shifts } = await db
    .from("shifts")
    .select("id,name,start_time,end_time,active")
    .eq("restaurant_id", session.restaurant_id)
    .order("sort_order");

  return (
    <TurnosClient
      shifts={(shifts ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        start: s.start_time,
        end: s.end_time,
        active: s.active,
      }))}
    />
  );
}

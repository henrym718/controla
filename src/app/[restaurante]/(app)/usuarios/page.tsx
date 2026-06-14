import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import UsuariosClient from "./usuarios-client";

export default async function UsuariosPage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);
  if (session.user_role !== "admin") redirect(`/${restaurante}/hoy`);

  const db = createAdminClient();
  const [{ data: users }, { data: shifts }] = await Promise.all([
    db
      .from("users")
      .select("id,name,role,active,default_shift_id,schedule_start,schedule_end")
      .eq("restaurant_id", session.restaurant_id)
      .order("role"),
    db
      .from("shifts")
      .select("id,name,start_time,end_time")
      .eq("restaurant_id", session.restaurant_id)
      .eq("active", true)
      .order("sort_order"),
  ]);

  return (
    <UsuariosClient
      users={(users ?? []).map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role,
        active: u.active,
        shiftId: u.default_shift_id,
        start: u.schedule_start,
        end: u.schedule_end,
      }))}
      shifts={(shifts ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        start: s.start_time,
        end: s.end_time,
      }))}
    />
  );
}

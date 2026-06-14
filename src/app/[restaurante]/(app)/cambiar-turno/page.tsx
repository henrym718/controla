import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDate } from "@/lib/shifts";
import CambiarTurnoClient from "./cambiar-turno-client";

export default async function CambiarTurnoPage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);

  const db = createAdminClient();
  const [{ data: shifts }, { data: openSessions }] = await Promise.all([
    db
      .from("shifts")
      .select("id,name,start_time,end_time")
      .eq("restaurant_id", session.restaurant_id)
      .eq("active", true)
      .order("sort_order"),
    db
      .from("shift_sessions")
      .select("shift_id")
      .eq("restaurant_id", session.restaurant_id)
      .eq("business_date", businessDate())
      .eq("status", "open"),
  ]);

  return (
    <CambiarTurnoClient
      shifts={(shifts ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        start: s.start_time,
        end: s.end_time,
      }))}
      openShiftIds={(openSessions ?? []).map((s) => s.shift_id)}
      currentShiftId={session.shift_id}
    />
  );
}

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDate } from "@/lib/shifts";
import BitacoraClient, { type LogRow } from "./bitacora-client";

export default async function BitacoraPage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);
  if (session.user_role !== "admin") redirect(`/${restaurante}/hoy`);

  const today = businessDate();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 6); // últimos 7 días (la retención también es 7)
  const from = businessDate(fromDate);

  const db = createAdminClient();
  const { data } = await db.rpc("bitacora_listar", {
    p_restaurant: session.restaurant_id,
    p_from: from,
    p_to: today,
  });

  return (
    <BitacoraClient
      today={today}
      initial={(data ?? []) as unknown as LogRow[]}
    />
  );
}

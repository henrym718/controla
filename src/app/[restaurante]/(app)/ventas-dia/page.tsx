import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDate } from "@/lib/shifts";
import { computeDaySales } from "@/lib/reports";
import VentasDiaClient from "./ventas-dia-client";

export default async function VentasDiaPage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);
  if (session.user_role !== "admin") redirect(`/${restaurante}/hoy`);

  const today = businessDate();
  const db = createAdminClient();
  const initial = await computeDaySales(db, session.restaurant_id, today);

  return <VentasDiaClient today={today} initial={initial} />;
}

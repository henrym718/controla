import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDate } from "@/lib/shifts";
import { computeDaySalidas } from "@/lib/reports";
import SalidasCajaClient from "./salidas-caja-client";

export default async function SalidasCajaPage({
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
  const initial = await computeDaySalidas(db, session.restaurant_id, today);

  return <SalidasCajaClient today={today} initial={initial} />;
}

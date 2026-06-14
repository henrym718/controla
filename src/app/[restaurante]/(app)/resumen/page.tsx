import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDate } from "@/lib/shifts";
import { computeDaySummary } from "@/lib/reports";
import ResumenClient from "./resumen-client";

export default async function ResumenPage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);

  const today = businessDate();
  const db = createAdminClient();
  const initial = await computeDaySummary(db, session.restaurant_id, today);

  return <ResumenClient slug={restaurante} today={today} initial={initial} />;
}

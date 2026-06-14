import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDate } from "@/lib/shifts";
import CuadresClient, { type CuadresDia } from "./cuadres-client";

export default async function CuadresPage({
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
  const { data } = await db.rpc("cuadres_dia", {
    p_restaurant: session.restaurant_id,
    p_date: today,
  });

  return (
    <CuadresClient today={today} initial={data as unknown as CuadresDia} />
  );
}

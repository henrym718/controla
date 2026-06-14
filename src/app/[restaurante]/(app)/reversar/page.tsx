import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDate } from "@/lib/shifts";
import ReversarClient, { type Operacion } from "./reversar-client";

export default async function ReversarPage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);
  // Accesible para admin Y empleada: ambas registran y pueden revertir.

  const to = businessDate();
  const d = new Date(`${to}T00:00:00`);
  d.setDate(d.getDate() - 7);
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;

  const db = createAdminClient();
  const { data } = await db.rpc("operaciones_reversibles", {
    p_restaurant: session.restaurant_id,
    p_from: from,
    p_to: to,
  });
  const ops = (data as unknown as Operacion[] | null) ?? [];

  return <ReversarClient ops={ops} />;
}

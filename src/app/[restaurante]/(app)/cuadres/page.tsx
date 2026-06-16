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
  const [{ data }, { data: cuentasRows }] = await Promise.all([
    db.rpc("cuadres_dia", { p_restaurant: session.restaurant_id, p_date: today }),
    db
      .from("cuentas_mesa")
      .select("total")
      .eq("restaurant_id", session.restaurant_id)
      .eq("status", "abierta"),
  ]);

  const cuentasMesa = {
    count: (cuentasRows ?? []).length,
    total: (cuentasRows ?? []).reduce((s, r) => s + Number(r.total), 0),
  };

  return (
    <CuadresClient
      today={today}
      initial={data as unknown as CuadresDia}
      cuentasMesa={cuentasMesa}
    />
  );
}

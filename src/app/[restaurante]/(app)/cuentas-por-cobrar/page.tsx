import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import CuentasPorCobrarClient from "./cuentas-por-cobrar-client";

export default async function CuentasPorCobrarPage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);

  const db = createAdminClient();
  const { data: saldos } = await db
    .from("v_saldos_credito")
    .select("cliente_id,name,kind,saldo")
    .eq("restaurant_id", session.restaurant_id)
    .gt("saldo", 0)
    .order("saldo", { ascending: false });

  return (
    <CuentasPorCobrarClient
      deudores={(saldos ?? []).map((s) => ({
        id: s.cliente_id as string,
        name: (s.name as string) ?? "—",
        kind: s.kind === "empleado" ? "empleado" : "cliente",
        saldo: Number(s.saldo),
      }))}
    />
  );
}

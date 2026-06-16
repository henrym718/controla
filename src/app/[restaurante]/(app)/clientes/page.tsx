import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import ClientesClient from "./clientes-client";

export default async function ClientesPage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);
  if (session.user_role !== "admin") redirect(`/${restaurante}/hoy`);

  const db = createAdminClient();
  const [{ data: clientes }, { data: saldos }] = await Promise.all([
    db
      .from("clientes")
      .select("id,name,kind,active")
      .eq("restaurant_id", session.restaurant_id)
      .order("name"),
    db
      .from("v_saldos_credito")
      .select("cliente_id,saldo")
      .eq("restaurant_id", session.restaurant_id),
  ]);

  const saldoBy = new Map(
    (saldos ?? []).map((s) => [s.cliente_id as string, Number(s.saldo)]),
  );

  return (
    <ClientesClient
      clientes={(clientes ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind === "empleado" ? "empleado" : "cliente",
        active: c.active,
        saldo: saldoBy.get(c.id) ?? 0,
      }))}
    />
  );
}

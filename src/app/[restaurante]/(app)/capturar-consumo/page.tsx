import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import CapturarClient from "../capturar/capturar-client";

export default async function CapturarConsumoPage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);

  const db = createAdminClient();
  const { data: shift } = await db
    .from("shifts")
    .select("name")
    .eq("id", session.shift_id)
    .maybeSingle();

  return (
    <CapturarClient
      slug={restaurante}
      shiftName={shift?.name ?? ""}
      agentUrl="/api/agent-consumo"
      commitUrl="/api/commit-consumo"
      titulo="Consumo de cocina"
    />
  );
}

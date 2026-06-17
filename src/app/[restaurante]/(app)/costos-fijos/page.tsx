import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDate } from "@/lib/shifts";
import { PageTitle } from "@/components/ui";
import CostosClient from "./costos-client";

export default async function CostosFijosPage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);
  if (session.user_role !== "admin") redirect(`/${restaurante}/hoy`);

  const db = createAdminClient();
  const { data: costs } = await db
    .from("recurring_costs")
    .select("id,name,amount,category,schedule_type,weekdays,effective_from")
    .eq("restaurant_id", session.restaurant_id)
    .eq("active", true)
    .order("category");

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Costos fijos" subtitle="Arriendo, sueldos, internet, préstamos…" />
      <CostosClient
        hoy={businessDate()}
        costs={(costs ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          amount: Number(c.amount),
          category: c.category,
          scheduleType: c.schedule_type,
          weekdays: (c.weekdays as number[] | null) ?? [],
          effectiveFrom: c.effective_from,
        }))}
      />
    </div>
  );
}

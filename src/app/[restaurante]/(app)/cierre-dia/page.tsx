import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDate } from "@/lib/shifts";
import { computeDaySummary } from "@/lib/reports";
import CierreDiaWizard, { type WizardTurno } from "./cierre-dia-client";
import type { ConteoEstado } from "../conteo/conteo-client";

interface TurnoRaw {
  shift: string;
  responsable: string | null;
  status: string;
  esperada: number | null;
  counted_cash: number | null;
  cash_discrepancy: number | null;
}

export default async function CierreDiaPage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);
  if (session.user_role !== "admin") redirect(`/${restaurante}/hoy`);

  const db = createAdminClient();
  const date = businessDate();

  const [cuadresRes, conteoRes, poolsRes, summary, dcRes, menuRes] = await Promise.all([
    db.rpc("cuadres_dia", { p_restaurant: session.restaurant_id, p_date: date }),
    db.rpc("conteo_estado", { p_restaurant: session.restaurant_id, p_date: date }),
    db
      .from("v_pool_granel")
      .select("ingredient_id,name,pool_cost")
      .eq("restaurant_id", session.restaurant_id)
      .eq("business_date", date),
    computeDaySummary(db, session.restaurant_id, date),
    db
      .from("daily_close")
      .select("status")
      .eq("restaurant_id", session.restaurant_id)
      .eq("business_date", date)
      .maybeSingle(),
    // Platos del menú de hoy (cualquier turno) para declarar los que sobraron.
    db
      .from("daily_menu")
      .select("dishes(id,name,is_extra,active)")
      .eq("restaurant_id", session.restaurant_id)
      .eq("business_date", date),
  ]);

  const turnosRaw =
    (cuadresRes.data as unknown as { turnos?: TurnoRaw[] } | null)?.turnos ?? [];
  const turnos: WizardTurno[] = turnosRaw.map((t) => ({
    shift: t.shift,
    responsable: t.responsable,
    status: t.status,
    esperada: Number(t.esperada ?? 0),
    contada: t.counted_cash == null ? null : Number(t.counted_cash),
    descuadre: t.cash_discrepancy == null ? null : Number(t.cash_discrepancy),
  }));

  const conteo =
    (conteoRes.data as unknown as ConteoEstado | null) ?? { date, locked: false, items: [] };
  const pools = (poolsRes.data ?? []).map((p) => ({
    ingredientId: p.ingredient_id ?? "",
    name: p.name ?? "",
    poolCost: Number(p.pool_cost ?? 0),
  }));
  const closed = dcRes.data?.status === "closed";

  // Platos del día (sin repetir, no adicionales) para declarar los que sobraron.
  type MenuDish = {
    dishes: { id: string; name: string; is_extra: boolean; active: boolean } | null;
  };
  const platosMap = new Map<string, string>();
  for (const m of (menuRes.data ?? []) as unknown as MenuDish[]) {
    const d = m.dishes;
    if (d && !d.is_extra && d.active) platosMap.set(d.id, d.name);
  }
  const platos = [...platosMap].map(([id, name]) => ({ id, name }));

  return (
    <CierreDiaWizard
      slug={restaurante}
      date={date}
      closed={closed}
      turnos={turnos}
      conteo={conteo}
      pools={pools}
      platos={platos}
      summary={summary}
    />
  );
}

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

  const [cuadresRes, conteoRes, poolsRes, summary, dcRes, ingsRes, stockRes] = await Promise.all([
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
    // Productos del inventario para dar de baja los que se dañaron / perdieron.
    db
      .from("ingredients")
      .select("id,name,kind,consumption_unit,last_unit_cost")
      .eq("restaurant_id", session.restaurant_id)
      .eq("active", true)
      .order("name"),
    db
      .from("v_stock_total")
      .select("ingredient_id,stock")
      .eq("restaurant_id", session.restaurant_id),
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

  // Productos del inventario (con su stock) para dar de baja los dañados / perdidos.
  const stockMap = new Map(
    (stockRes.data ?? []).map((s) => [s.ingredient_id, Number(s.stock ?? 0)]),
  );
  const productos = (ingsRes.data ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    unit: i.consumption_unit ?? null,
    cost: Number(i.last_unit_cost ?? 0),
    stock: stockMap.get(i.id) ?? 0,
  }));

  return (
    <CierreDiaWizard
      slug={restaurante}
      date={date}
      closed={closed}
      turnos={turnos}
      conteo={conteo}
      pools={pools}
      productos={productos}
      summary={summary}
    />
  );
}

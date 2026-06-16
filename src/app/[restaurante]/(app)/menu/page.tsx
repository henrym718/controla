import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDate } from "@/lib/shifts";
import MenuClient from "./menu-client";

export default async function MenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurante: string }>;
  searchParams: Promise<{ date?: string; shift?: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);

  const db = createAdminClient();
  const isAdmin = session.user_role === "admin";
  const sp = await searchParams;
  const today = businessDate();
  // La empleada queda fijada a HOY + su turno; la admin navega libremente.
  const date = isAdmin && sp.date ? sp.date : today;
  const shiftId = isAdmin && sp.shift ? sp.shift : session.shift_id;

  // Turnos primero: necesitamos saber cuál es "Todo el día" para heredar su menú.
  const { data: shifts } = await db
    .from("shifts")
    .select("id,name,sort_order,is_all_day")
    .eq("restaurant_id", session.restaurant_id)
    .eq("active", true)
    .order("sort_order");

  const allDayId = (shifts ?? []).find((s) => s.is_all_day)?.id ?? null;
  const isAllDayShift = !!allDayId && allDayId === shiftId;
  // En un turno normal mostramos también lo de "Todo el día" (heredado).
  const shiftIds =
    allDayId && allDayId !== shiftId ? [shiftId, allDayId] : [shiftId];

  const [{ data: dishes }, { data: menu }] = await Promise.all([
    db
      .from("dishes")
      .select("id,name,price,is_combo,is_extra")
      .eq("restaurant_id", session.restaurant_id)
      .eq("active", true)
      .eq("is_extra", false) // adicionales NO van al menú: siempre aparecen en la venta
      .order("name"),
    db
      .from("daily_menu")
      .select("dish_id,shift_id,price,available")
      .eq("restaurant_id", session.restaurant_id)
      .eq("business_date", date)
      .in("shift_id", shiftIds),
  ]);

  // own = lo fijado en ESTE turno (editable); allDay = heredado de "Todo el día".
  const own = new Map<string, { price: number; available: boolean }>();
  const allDay = new Map<string, { price: number; available: boolean }>();
  for (const m of menu ?? []) {
    const bucket =
      m.shift_id === shiftId ? own : m.shift_id === allDayId ? allDay : null;
    bucket?.set(m.dish_id, { price: Number(m.price), available: m.available });
  }

  const shiftName = (shifts ?? []).find((s) => s.id === shiftId)?.name ?? "turno";

  return (
    <MenuClient
      isAdmin={isAdmin}
      today={today}
      date={date}
      shiftId={shiftId}
      shiftName={shiftName}
      isAllDayShift={isAllDayShift}
      shifts={(shifts ?? []).map((s) => ({ id: s.id, name: s.name }))}
      dishes={(dishes ?? []).map((d) => {
        const o = own.get(d.id);
        const a = allDay.get(d.id);
        const eff = o ?? a;
        return {
          id: d.id,
          name: d.name,
          catalogPrice: Number(d.price),
          inMenu: !!o,
          inheritedFromAllDay: !o && !!a,
          price: eff?.price ?? Number(d.price),
          available: eff?.available ?? true,
          kind: d.is_combo ? ("combo" as const) : d.is_extra ? ("extra" as const) : ("plato" as const),
        };
      })}
    />
  );
}

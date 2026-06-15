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

  const [{ data: dishes }, { data: menu }, { data: shifts }] = await Promise.all([
    db
      .from("dishes")
      .select("id,name,price,is_combo,is_extra")
      .eq("restaurant_id", session.restaurant_id)
      .eq("active", true)
      .order("name"),
    db
      .from("daily_menu")
      .select("dish_id,price,available")
      .eq("restaurant_id", session.restaurant_id)
      .eq("business_date", date)
      .eq("shift_id", shiftId),
    db
      .from("shifts")
      .select("id,name,sort_order")
      .eq("restaurant_id", session.restaurant_id)
      .eq("active", true)
      .order("sort_order"),
  ]);

  const menuMap = new Map(
    (menu ?? []).map((m) => [m.dish_id, { price: Number(m.price), available: m.available }]),
  );
  const shiftName = (shifts ?? []).find((s) => s.id === shiftId)?.name ?? "turno";

  return (
    <MenuClient
      isAdmin={isAdmin}
      today={today}
      date={date}
      shiftId={shiftId}
      shiftName={shiftName}
      shifts={(shifts ?? []).map((s) => ({ id: s.id, name: s.name }))}
      dishes={(dishes ?? []).map((d) => {
        const inMenu = menuMap.get(d.id);
        return {
          id: d.id,
          name: d.name,
          catalogPrice: Number(d.price),
          inMenu: !!inMenu,
          price: inMenu?.price ?? Number(d.price),
          available: inMenu?.available ?? true,
          kind: d.is_combo ? ("combo" as const) : d.is_extra ? ("extra" as const) : ("plato" as const),
        };
      })}
    />
  );
}

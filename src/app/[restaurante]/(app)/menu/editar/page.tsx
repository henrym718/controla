import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDate } from "@/lib/shifts";
import { allDayShiftId } from "@/lib/menu";
import MenuClient from "./menu-client";

export default async function EditarMenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurante: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);

  const db = createAdminClient();
  const isAdmin = session.user_role === "admin";
  const sp = await searchParams;
  const today = businessDate();
  // La empleada queda fijada a HOY; la admin navega libremente por fecha.
  const date = isAdmin && sp.date ? sp.date : today;

  // El menú es de TODO EL DÍA: siempre operamos sobre ese turno (sin franjas).
  const allDayId = await allDayShiftId(db, session.restaurant_id);

  const [{ data: dishes }, { data: catalog }, { data: menu }] = await Promise.all([
    db
      .from("dishes")
      .select("id,name,price,is_combo,is_extra")
      .eq("restaurant_id", session.restaurant_id)
      .eq("active", true)
      .eq("is_extra", false) // adicionales NO van al menú: siempre aparecen en la venta
      .order("name"),
    // Catálogo completo (platos + adicionales, NO combos) para poder armar un
    // combo nuevo desde el editor sin pasar por la pantalla de Catálogo.
    db
      .from("dishes")
      .select("id,name,price,category,is_extra")
      .eq("restaurant_id", session.restaurant_id)
      .eq("active", true)
      .eq("is_combo", false)
      .order("name"),
    db
      .from("daily_menu")
      .select("dish_id,price,available,sort_order")
      .eq("restaurant_id", session.restaurant_id)
      .eq("business_date", date)
      .eq("shift_id", allDayId ?? ""),
  ]);

  const comboItems = (catalog ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    price: Number(d.price),
    isExtra: !!d.is_extra,
    category: d.category === "sopa" ? ("sopa" as const) : ("principal" as const),
  }));

  const enMenu = new Map<string, { price: number; available: boolean; sortOrder: number }>();
  for (const m of menu ?? []) {
    enMenu.set(m.dish_id, {
      price: Number(m.price),
      available: m.available,
      sortOrder: Number(m.sort_order ?? 0),
    });
  }

  return (
    <MenuClient
      isAdmin={isAdmin}
      today={today}
      date={date}
      comboItems={comboItems}
      dishes={(dishes ?? []).map((d) => {
        const o = enMenu.get(d.id);
        return {
          id: d.id,
          name: d.name,
          catalogPrice: Number(d.price),
          inMenu: !!o,
          price: o?.price ?? Number(d.price),
          available: o?.available ?? true,
          sortOrder: o?.sortOrder ?? 0,
          kind: d.is_combo ? ("combo" as const) : ("plato" as const),
        };
      })}
    />
  );
}

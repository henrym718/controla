"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth/session";
import { businessDate } from "@/lib/shifts";
import { allDayShiftId } from "@/lib/menu";
import { logActivity, type EventCode } from "@/lib/activity";
import type { SessionClaims } from "@/lib/auth/jwt";
import type { Json } from "@/lib/supabase/database.types";

export interface ActionResult {
  error?: string;
  ok?: boolean;
  count?: number;
}

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

async function ctx() {
  const session = await getSession();
  if (!session) throw new Error("No autenticado");
  return { session, db: createAdminClient() };
}

type MenuDb = ReturnType<typeof createAdminClient>;

async function logMenu(
  session: SessionClaims,
  db: MenuDb,
  event: EventCode,
  description: string,
  metadata?: Record<string, unknown>,
) {
  await logActivity(db, {
    restaurantId: session.restaurant_id,
    userId: session.user_id,
    actorName: session.user_name,
    shiftSessionId: session.shift_session_id,
    source: "manual",
    event,
    description,
    metadata,
  });
}

async function nombrePlato(db: MenuDb, dishId: string): Promise<string> {
  const { data } = await db.from("dishes").select("name").eq("id", dishId).maybeSingle();
  return data?.name ?? "un plato";
}

// El menú es de TODO EL DÍA (no hay franjas horarias): el turno SIEMPRE es el de
// "Todo el día". La admin puede editar cualquier fecha; la empleada solo HOY.
async function menuTarget(session: SessionClaims, db: MenuDb, date?: string) {
  const allDay = await allDayShiftId(db, session.restaurant_id);
  const shiftId = allDay ?? session.shift_id;
  const d = session.user_role === "admin" ? date || businessDate() : businessDate();
  return { date: d, shiftId };
}

function revalidateMenu(slug: string) {
  revalidatePath(`/${slug}/menu`);
  revalidatePath(`/${slug}/menu/editar`);
}

export async function agregarAlMenu(input: {
  dishId: string;
  price: number;
  date?: string;
}): Promise<ActionResult> {
  const { session, db } = await ctx();
  if (!(input.price > 0)) return { error: "Indica un precio válido." };
  const t = await menuTarget(session, db, input.date);
  const { error } = await db.from("daily_menu").upsert(
    {
      restaurant_id: session.restaurant_id,
      business_date: t.date,
      shift_id: t.shiftId,
      dish_id: input.dishId,
      price: input.price,
      available: true,
    },
    { onConflict: "restaurant_id,business_date,shift_id,dish_id" },
  );
  if (error) return { error: error.message };
  await logMenu(
    session,
    db,
    "menu",
    `Agregó ${await nombrePlato(db, input.dishId)} al menú del ${t.date} (${money(input.price)})`,
    { date: t.date, price: input.price },
  );
  revalidateMenu(session.slug);
  return { ok: true };
}

// Agrega varios platos al menú de una sola vez (ej. "todos los adicionales").
export async function agregarVariosAlMenu(input: {
  items: { dishId: string; price: number }[];
  date?: string;
}): Promise<ActionResult> {
  const { session, db } = await ctx();
  const t = await menuTarget(session, db, input.date);
  const rows = (input.items ?? [])
    .filter((i) => i.dishId && i.price > 0)
    .map((i) => ({
      restaurant_id: session.restaurant_id,
      business_date: t.date,
      shift_id: t.shiftId,
      dish_id: i.dishId,
      price: i.price,
      available: true,
    }));
  if (rows.length === 0) return { error: "No hay nada para agregar (revisa los precios)." };
  const { error } = await db
    .from("daily_menu")
    .upsert(rows, { onConflict: "restaurant_id,business_date,shift_id,dish_id" });
  if (error) return { error: error.message };
  await logMenu(
    session,
    db,
    "menu",
    `Agregó ${rows.length} ítem(s) al menú del ${t.date}`,
    { date: t.date, count: rows.length },
  );
  revalidateMenu(session.slug);
  return { ok: true, count: rows.length };
}

// Crea un combo (en el catálogo) sin salir del editor de menú y, si se indica
// precio, lo deja agregado al menú del día — así no hay que ir a Catálogo, crear
// el combo y volver. Solo admin. Reusa el RPC armar_combo (el mismo del catálogo).
export async function crearComboEnMenu(input: {
  parts: { dishId: string; role: "sopa" | "segundo" | "adicional" }[];
  name?: string;
  price?: number | null;
  date?: string;
}): Promise<ActionResult> {
  const { session, db } = await ctx();
  if (session.user_role !== "admin")
    return { error: "Solo la administradora puede crear combos." };
  const parts = (input.parts ?? []).filter((p) => p.dishId);
  if (parts.length < 2) return { error: "Un combo necesita al menos 2 ítems." };

  const { data, error } = await db.rpc("armar_combo", {
    p_restaurant: session.restaurant_id,
    p_parts: parts.map((p) => ({ dish_id: p.dishId, role: p.role })) as unknown as Json,
    p_name: input.name?.trim() || undefined,
    p_price: input.price ?? undefined,
    p_user: session.user_id,
  });
  if (error) return { error: error.message };

  const combo = data as { combo_dish_id?: string; name?: string } | null;

  // Con precio: lo dejamos listo en el menú del día (el objetivo: no salir del
  // editor). Sin precio: queda solo creado en el catálogo para agregarlo a mano.
  if (combo?.combo_dish_id && input.price && input.price > 0) {
    const t = await menuTarget(session, db, input.date);
    await db.from("daily_menu").upsert(
      {
        restaurant_id: session.restaurant_id,
        business_date: t.date,
        shift_id: t.shiftId,
        dish_id: combo.combo_dish_id,
        price: input.price,
        available: true,
      },
      { onConflict: "restaurant_id,business_date,shift_id,dish_id" },
    );
  }

  await logMenu(
    session,
    db,
    "menu",
    `Creó el combo ${combo?.name ?? "nuevo"}${input.price && input.price > 0 ? ` y lo agregó al menú (${money(input.price)})` : ""}`,
    { combo: combo?.name, parts: parts.length, price: input.price ?? null },
  );
  revalidateMenu(session.slug);
  revalidatePath(`/${session.slug}/catalogo`);
  return { ok: true };
}

export async function quitarDelMenu(input: {
  dishId: string;
  date?: string;
}): Promise<ActionResult> {
  const { session, db } = await ctx();
  const t = await menuTarget(session, db, input.date);
  const nombre = await nombrePlato(db, input.dishId);
  await db
    .from("daily_menu")
    .delete()
    .eq("restaurant_id", session.restaurant_id)
    .eq("business_date", t.date)
    .eq("shift_id", t.shiftId)
    .eq("dish_id", input.dishId);
  await logMenu(session, db, "menu", `Quitó ${nombre} del menú del ${t.date}`, { date: t.date });
  revalidateMenu(session.slug);
  return { ok: true };
}

export async function toggleAgotado(input: {
  dishId: string;
  available: boolean;
  date?: string;
}): Promise<ActionResult> {
  const { session, db } = await ctx();
  const t = await menuTarget(session, db, input.date);
  await db
    .from("daily_menu")
    .update({ available: input.available })
    .eq("restaurant_id", session.restaurant_id)
    .eq("business_date", t.date)
    .eq("shift_id", t.shiftId)
    .eq("dish_id", input.dishId);
  await logMenu(
    session,
    db,
    "agotado",
    `${input.available ? "Repuso" : "Marcó agotado"} ${await nombrePlato(db, input.dishId)}`,
    { available: input.available },
  );
  revalidateMenu(session.slug);
  return { ok: true };
}

// Copia el menú (de TODO EL DÍA) de srcDate a varias fechas. Solo admin.
export async function copiarMenu(input: {
  srcDate: string;
  dates: string[];
}): Promise<ActionResult> {
  const { session, db } = await ctx();
  if (session.user_role !== "admin")
    return { error: "Solo la administradora puede programar." };
  if (!input.dates.length) return { error: "Elige al menos una fecha." };

  const allDay = await allDayShiftId(db, session.restaurant_id);
  const shiftId = allDay ?? session.shift_id;

  const { data: src } = await db
    .from("daily_menu")
    .select("dish_id,price,available,sort_order")
    .eq("restaurant_id", session.restaurant_id)
    .eq("business_date", input.srcDate)
    .eq("shift_id", shiftId);
  if (!src || src.length === 0) return { error: "El menú base está vacío." };

  const rows = input.dates.flatMap((d) =>
    src.map((s) => ({
      restaurant_id: session.restaurant_id,
      business_date: d,
      shift_id: shiftId,
      dish_id: s.dish_id,
      price: s.price,
      available: s.available,
      sort_order: s.sort_order,
    })),
  );
  const { error } = await db
    .from("daily_menu")
    .upsert(rows, { onConflict: "restaurant_id,business_date,shift_id,dish_id" });
  if (error) return { error: error.message };
  await logMenu(
    session,
    db,
    "menu",
    `Copió el menú a ${input.dates.length} día(s)`,
    { dias: input.dates.length },
  );
  revalidateMenu(session.slug);
  return { ok: true, count: input.dates.length };
}

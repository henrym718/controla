"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth/session";
import { businessDate } from "@/lib/shifts";
import { logActivity, type EventCode } from "@/lib/activity";
import type { SessionClaims } from "@/lib/auth/jwt";

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

// La admin puede programar cualquier fecha/turno; la empleada solo HOY + su turno.
function target(session: SessionClaims, date?: string, shiftId?: string) {
  if (session.user_role === "admin") {
    return { date: date || businessDate(), shiftId: shiftId || session.shift_id };
  }
  return { date: businessDate(), shiftId: session.shift_id };
}

export async function agregarAlMenu(input: {
  dishId: string;
  price: number;
  date?: string;
  shiftId?: string;
}): Promise<ActionResult> {
  const { session, db } = await ctx();
  if (!(input.price > 0)) return { error: "Indica un precio válido." };
  const t = target(session, input.date, input.shiftId);
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
  revalidatePath(`/${session.slug}/menu`);
  return { ok: true };
}

export async function quitarDelMenu(input: {
  dishId: string;
  date?: string;
  shiftId?: string;
}): Promise<ActionResult> {
  const { session, db } = await ctx();
  const t = target(session, input.date, input.shiftId);
  const nombre = await nombrePlato(db, input.dishId);
  await db
    .from("daily_menu")
    .delete()
    .eq("restaurant_id", session.restaurant_id)
    .eq("business_date", t.date)
    .eq("shift_id", t.shiftId)
    .eq("dish_id", input.dishId);
  await logMenu(session, db, "menu", `Quitó ${nombre} del menú del ${t.date}`, { date: t.date });
  revalidatePath(`/${session.slug}/menu`);
  return { ok: true };
}

export async function toggleAgotado(input: {
  dishId: string;
  available: boolean;
  date?: string;
  shiftId?: string;
}): Promise<ActionResult> {
  const { session, db } = await ctx();
  const t = target(session, input.date, input.shiftId);
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
  revalidatePath(`/${session.slug}/menu`);
  return { ok: true };
}

// Copia el menú de (srcDate, srcShift) a varias fechas del turno destino. Solo admin.
export async function copiarMenu(input: {
  srcDate: string;
  srcShiftId: string;
  targetShiftId: string;
  dates: string[];
}): Promise<ActionResult> {
  const { session, db } = await ctx();
  if (session.user_role !== "admin")
    return { error: "Solo la administradora puede programar." };
  if (!input.dates.length) return { error: "Elige al menos una fecha." };

  const { data: src } = await db
    .from("daily_menu")
    .select("dish_id,price,available,sort_order")
    .eq("restaurant_id", session.restaurant_id)
    .eq("business_date", input.srcDate)
    .eq("shift_id", input.srcShiftId);
  if (!src || src.length === 0) return { error: "El menú base está vacío." };

  const rows = input.dates.flatMap((d) =>
    src.map((s) => ({
      restaurant_id: session.restaurant_id,
      business_date: d,
      shift_id: input.targetShiftId,
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
  revalidatePath(`/${session.slug}/menu`);
  return { ok: true, count: input.dates.length };
}

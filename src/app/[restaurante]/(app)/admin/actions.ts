"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth/session";
import { businessDate } from "@/lib/shifts";
import type { Json } from "@/lib/supabase/database.types";

export interface ActionResult {
  error?: string;
  ok?: boolean;
}

async function admin() {
  const session = await getSession();
  if (!session || session.user_role !== "admin") {
    throw new Error("No autorizado");
  }
  return { session, db: createAdminClient() };
}

// ---------------------------------------------------------------- Usuarios
export async function crearUsuario(input: {
  name: string;
  role: string;
  pin: string;
  shiftId?: string | null;
  start?: string | null;
  end?: string | null;
}): Promise<ActionResult> {
  const { session, db } = await admin();
  const { error } = await db.rpc("admin_create_user", {
    p_restaurant: session.restaurant_id,
    p_name: input.name,
    p_role: input.role,
    p_pin: input.pin,
    p_shift_id: input.shiftId || undefined,
    p_start: input.start || undefined,
    p_end: input.end || undefined,
  });
  if (error) return { error: error.message };
  revalidatePath(`/${session.slug}/usuarios`);
  return { ok: true };
}

export async function cambiarPin(
  userId: string,
  pin: string,
): Promise<ActionResult> {
  const { session, db } = await admin();
  const { error } = await db.rpc("admin_set_pin", { p_user: userId, p_pin: pin });
  if (error) return { error: error.message };
  revalidatePath(`/${session.slug}/usuarios`);
  return { ok: true };
}

export async function actualizarUsuario(
  userId: string,
  input: {
    name: string;
    role: string;
    shiftId?: string | null;
    start?: string | null;
    end?: string | null;
  },
): Promise<ActionResult> {
  const { session, db } = await admin();
  const { error } = await db
    .from("users")
    .update({
      name: input.name,
      role: input.role === "admin" ? "admin" : "empleado",
      default_shift_id: input.shiftId || null,
      schedule_start: input.start || null,
      schedule_end: input.end || null,
    })
    .eq("id", userId)
    .eq("restaurant_id", session.restaurant_id);
  if (error) return { error: error.message };
  revalidatePath(`/${session.slug}/usuarios`);
  return { ok: true };
}

export async function toggleUsuario(
  userId: string,
  active: boolean,
): Promise<ActionResult> {
  const { session, db } = await admin();
  await db
    .from("users")
    .update({ active })
    .eq("id", userId)
    .eq("restaurant_id", session.restaurant_id);
  revalidatePath(`/${session.slug}/usuarios`);
  return { ok: true };
}

export async function eliminarUsuario(userId: string): Promise<ActionResult> {
  const { session, db } = await admin();
  const { error } = await db
    .from("users")
    .delete()
    .eq("id", userId)
    .eq("restaurant_id", session.restaurant_id);
  if (error) {
    await db
      .from("users")
      .update({ active: false })
      .eq("id", userId)
      .eq("restaurant_id", session.restaurant_id);
    revalidatePath(`/${session.slug}/usuarios`);
    return { error: "Tiene historial; se desactivó en lugar de borrar." };
  }
  revalidatePath(`/${session.slug}/usuarios`);
  return { ok: true };
}

// ---------------------------------------------------------------- Turnos
export async function crearTurno(input: {
  name: string;
  start: string;
  end: string;
}): Promise<ActionResult> {
  const { session, db } = await admin();
  const { error } = await db.from("shifts").insert({
    restaurant_id: session.restaurant_id,
    name: input.name,
    start_time: input.start,
    end_time: input.end,
    sort_order: 99,
  });
  if (error) return { error: error.message };
  revalidatePath(`/${session.slug}/turnos`);
  return { ok: true };
}

export async function actualizarTurno(
  id: string,
  input: { name: string; start: string; end: string },
): Promise<ActionResult> {
  const { session, db } = await admin();
  const { error } = await db
    .from("shifts")
    .update({ name: input.name, start_time: input.start, end_time: input.end })
    .eq("id", id)
    .eq("restaurant_id", session.restaurant_id);
  if (error) return { error: error.message };
  revalidatePath(`/${session.slug}/turnos`);
  return { ok: true };
}

export async function eliminarTurno(id: string): Promise<ActionResult> {
  const { session, db } = await admin();
  const { error } = await db
    .from("shifts")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", session.restaurant_id);
  if (error) {
    await db
      .from("shifts")
      .update({ active: false })
      .eq("id", id)
      .eq("restaurant_id", session.restaurant_id);
    revalidatePath(`/${session.slug}/turnos`);
    return { error: "Tiene historial; se desactivó en lugar de borrar." };
  }
  revalidatePath(`/${session.slug}/turnos`);
  return { ok: true };
}

// ---------------------------------------------------------------- Costos fijos
export async function crearCosto(input: {
  name: string;
  amount: number;
  category: string;
  scheduleType: string;
  dayOfMonth?: number | null;
}): Promise<ActionResult> {
  const { session, db } = await admin();
  const { error } = await db.from("recurring_costs").insert({
    restaurant_id: session.restaurant_id,
    name: input.name,
    amount: input.amount,
    category: input.category,
    schedule_type: input.scheduleType,
    day_of_month: input.dayOfMonth || null,
  });
  if (error) return { error: error.message };
  revalidatePath(`/${session.slug}/costos-fijos`);
  return { ok: true };
}

export async function eliminarCosto(id: string): Promise<ActionResult> {
  const { session, db } = await admin();
  await db
    .from("recurring_costs")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", session.restaurant_id);
  revalidatePath(`/${session.slug}/costos-fijos`);
  return { ok: true };
}

// ---------------------------------------------------------------- Catálogo de platos
export async function crearPlato(input: {
  name: string;
  price: number;
}): Promise<ActionResult> {
  const { session, db } = await admin();
  const { error } = await db.from("dishes").insert({
    restaurant_id: session.restaurant_id,
    name: input.name,
    price: input.price,
  });
  if (error) return { error: error.message };
  revalidatePath(`/${session.slug}/catalogo`);
  return { ok: true };
}

export async function actualizarPlato(
  id: string,
  input: { name: string; price: number; active: boolean },
): Promise<ActionResult> {
  const { session, db } = await admin();
  const { error } = await db
    .from("dishes")
    .update({ name: input.name, price: input.price, active: input.active })
    .eq("id", id)
    .eq("restaurant_id", session.restaurant_id);
  if (error) return { error: error.message };
  revalidatePath(`/${session.slug}/catalogo`);
  return { ok: true };
}

export async function eliminarPlato(id: string): Promise<ActionResult> {
  const { session, db } = await admin();
  const { error } = await db
    .from("dishes")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", session.restaurant_id);
  if (error) {
    await db
      .from("dishes")
      .update({ active: false })
      .eq("id", id)
      .eq("restaurant_id", session.restaurant_id);
    revalidatePath(`/${session.slug}/catalogo`);
    return { error: "Tiene historial; se desactivó en lugar de borrar." };
  }
  revalidatePath(`/${session.slug}/catalogo`);
  return { ok: true };
}

// ---------------------------------------------------------------- Agregar producto al inventario (manual)
export async function agregarProductoInventario(input: {
  name: string;
  qty: number;
  totalCost: number;
  salePrice?: number | null;
}): Promise<ActionResult> {
  const { session, db } = await admin();
  if (!input.name.trim() || !input.qty || input.qty <= 0) {
    return { error: "Completa nombre y cantidad." };
  }
  const unit = input.totalCost / input.qty;
  const sellable = input.salePrice != null && input.salePrice > 0;

  const { data: existing } = await db
    .from("ingredients")
    .select("id")
    .eq("restaurant_id", session.restaurant_id)
    .ilike("name", input.name.trim())
    .limit(1);

  let ingId = existing?.[0]?.id;
  if (!ingId) {
    const { data: created, error } = await db
      .from("ingredients")
      .insert({
        restaurant_id: session.restaurant_id,
        name: input.name.trim(),
        kind: "contable",
        costing_method: "conversion",
        consumption_unit: "unidad",
        conversion_factor: 1,
        last_unit_cost: unit,
        is_sellable: sellable,
        sale_price: sellable ? input.salePrice : null,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };
    ingId = created?.id;
  } else {
    await db
      .from("ingredients")
      .update({
        last_unit_cost: unit,
        active: true,
        ...(sellable ? { is_sellable: true, sale_price: input.salePrice } : {}),
      })
      .eq("id", ingId);
  }

  await db.from("inventory_movements").insert({
    restaurant_id: session.restaurant_id,
    ingredient_id: ingId!,
    shift_session_id: session.shift_session_id,
    business_date: businessDate(),
    type: "compra",
    qty: input.qty,
    unit_cost: unit,
  });

  revalidatePath(`/${session.slug}/inventario`);
  return { ok: true };
}

// ---------------------------------------------------------------- Ajuste de inventario (auditado)
export async function ajustarInventario(input: {
  ingredientId: string;
  newQty: number;
  reason: string;
  pin: string;
}): Promise<ActionResult> {
  const { session, db } = await admin();
  if (!input.reason.trim()) return { error: "El motivo es obligatorio." };

  // Confirmar con PIN de administradora
  const { data: users } = await db.rpc("login_pin", {
    p_restaurant: session.restaurant_id,
    p_pin: input.pin,
  });
  const u = users?.[0];
  if (!u || u.role !== "admin") return { error: "PIN de administradora inválido." };

  const [{ data: stock }, { data: ing }] = await Promise.all([
    db
      .from("v_stock_contable")
      .select("stock")
      .eq("restaurant_id", session.restaurant_id)
      .eq("ingredient_id", input.ingredientId)
      .maybeSingle(),
    db
      .from("ingredients")
      .select("last_unit_cost")
      .eq("id", input.ingredientId)
      .maybeSingle(),
  ]);
  const current = Number(stock?.stock ?? 0);
  const diff = input.newQty - current;
  const unitCost = Number(ing?.last_unit_cost ?? 0);

  await db.from("inventory_movements").insert({
    restaurant_id: session.restaurant_id,
    ingredient_id: input.ingredientId,
    shift_session_id: session.shift_session_id,
    business_date: businessDate(),
    type: "ajuste",
    qty: diff,
    unit_cost: unitCost,
    reason: input.reason,
    user_id: session.user_id,
  });
  await db.from("audit_log").insert({
    restaurant_id: session.restaurant_id,
    user_id: session.user_id,
    shift_session_id: session.shift_session_id,
    action: "ajuste_inventario",
    entity: "ingredients",
    entity_id: input.ingredientId,
    payload: { from: current, to: input.newQty, diff } as Json,
    reason: input.reason,
  });
  revalidatePath(`/${session.slug}/inventario`);
  return { ok: true };
}

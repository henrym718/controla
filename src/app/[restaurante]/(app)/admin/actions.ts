"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth/session";
import { businessDate } from "@/lib/shifts";
import { logActivity, type EventCode } from "@/lib/activity";
import type { SessionClaims } from "@/lib/auth/jwt";
import type { Json } from "@/lib/supabase/database.types";

export interface ActionResult {
  error?: string;
  ok?: boolean;
}

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

async function admin() {
  const session = await getSession();
  if (!session || session.user_role !== "admin") {
    throw new Error("No autorizado");
  }
  return { session, db: createAdminClient() };
}

type AdminDb = ReturnType<typeof createAdminClient>;

/** Registra una acción manual de administración en la bitácora. */
async function logAdmin(
  session: SessionClaims,
  db: AdminDb,
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

/** Nombre de una fila por id (para descripciones coherentes cuando solo hay id). */
async function nombreDe(
  db: AdminDb,
  table: "users" | "shifts" | "dishes" | "recurring_costs" | "ingredients",
  id: string,
): Promise<string> {
  const { data } = await db.from(table).select("name").eq("id", id).maybeSingle();
  return (data as { name?: string } | null)?.name ?? "—";
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
  await logAdmin(
    session,
    db,
    "usuario",
    `Creó el usuario ${input.name} (${input.role === "admin" ? "admin" : "empleado"})`,
    { name: input.name, role: input.role },
  );
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
  await logAdmin(session, db, "usuario", `Cambió el PIN de ${await nombreDe(db, "users", userId)}`);
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
  await logAdmin(session, db, "usuario", `Editó el usuario ${input.name}`, { name: input.name });
  revalidatePath(`/${session.slug}/usuarios`);
  return { ok: true };
}

export async function toggleUsuario(
  userId: string,
  active: boolean,
): Promise<ActionResult> {
  const { session, db } = await admin();
  const nombre = await nombreDe(db, "users", userId);
  await db
    .from("users")
    .update({ active })
    .eq("id", userId)
    .eq("restaurant_id", session.restaurant_id);
  await logAdmin(
    session,
    db,
    "usuario",
    `${active ? "Activó" : "Desactivó"} a ${nombre}`,
  );
  revalidatePath(`/${session.slug}/usuarios`);
  return { ok: true };
}

export async function eliminarUsuario(userId: string): Promise<ActionResult> {
  const { session, db } = await admin();
  const nombre = await nombreDe(db, "users", userId);
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
    await logAdmin(session, db, "usuario", `Desactivó a ${nombre} (tiene historial)`);
    revalidatePath(`/${session.slug}/usuarios`);
    return { error: "Tiene historial; se desactivó en lugar de borrar." };
  }
  await logAdmin(session, db, "usuario", `Eliminó a ${nombre}`);
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
  await logAdmin(session, db, "turno_config", `Creó el turno ${input.name} (${input.start}–${input.end})`, {
    name: input.name,
  });
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
  await logAdmin(session, db, "turno_config", `Editó el turno ${input.name}`, { name: input.name });
  revalidatePath(`/${session.slug}/turnos`);
  return { ok: true };
}

export async function eliminarTurno(id: string): Promise<ActionResult> {
  const { session, db } = await admin();
  const nombre = await nombreDe(db, "shifts", id);
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
    await logAdmin(session, db, "turno_config", `Desactivó el turno ${nombre} (tiene historial)`);
    revalidatePath(`/${session.slug}/turnos`);
    return { error: "Tiene historial; se desactivó en lugar de borrar." };
  }
  await logAdmin(session, db, "turno_config", `Eliminó el turno ${nombre}`);
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
  await logAdmin(
    session,
    db,
    "costo_fijo",
    `Agregó el costo fijo ${input.name} (${money(input.amount)})`,
    { name: input.name, amount: input.amount },
  );
  revalidatePath(`/${session.slug}/costos-fijos`);
  return { ok: true };
}

export async function eliminarCosto(id: string): Promise<ActionResult> {
  const { session, db } = await admin();
  const nombre = await nombreDe(db, "recurring_costs", id);
  await db
    .from("recurring_costs")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", session.restaurant_id);
  await logAdmin(session, db, "costo_fijo", `Eliminó el costo fijo ${nombre}`);
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
  await logAdmin(session, db, "plato_config", `Creó el plato ${input.name} (${money(input.price)})`, {
    name: input.name,
    price: input.price,
  });
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
  await logAdmin(
    session,
    db,
    "plato_config",
    `Editó el plato ${input.name} (${money(input.price)}${input.active ? "" : ", inactivo"})`,
    { name: input.name, price: input.price, active: input.active },
  );
  revalidatePath(`/${session.slug}/catalogo`);
  return { ok: true };
}

export async function eliminarPlato(id: string): Promise<ActionResult> {
  const { session, db } = await admin();
  const nombre = await nombreDe(db, "dishes", id);
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
    await logAdmin(session, db, "plato_config", `Desactivó el plato ${nombre} (tiene historial)`);
    revalidatePath(`/${session.slug}/catalogo`);
    return { error: "Tiene historial; se desactivó en lugar de borrar." };
  }
  await logAdmin(session, db, "plato_config", `Eliminó el plato ${nombre}`);
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

  await logAdmin(
    session,
    db,
    "producto_nuevo",
    `Agregó ${input.qty} × ${input.name.trim()} al inventario (${money(input.totalCost)})`,
    { name: input.name.trim(), qty: input.qty, total_cost: input.totalCost },
  );

  revalidatePath(`/${session.slug}/inventario`);
  return { ok: true };
}

// ---------------------------------------------------------------- Conteo de cierre (esperado vs contado)
export async function registrarConteoAction(
  date: string,
  counts: { ingredientId: string; countedQty: number; tag?: string | null }[],
): Promise<{ error?: string; faltante?: number }> {
  const { session, db } = await admin();
  if (counts.length === 0) return { error: "No hay nada que contar." };
  const { data, error } = await db.rpc("registrar_conteo", {
    p_restaurant: session.restaurant_id,
    p_session: session.shift_session_id,
    p_user: session.user_id,
    p_date: date,
    p_counts: counts.map((c) => ({
      ingredient_id: c.ingredientId,
      counted_qty: c.countedQty,
      tag: c.tag ?? null,
    })) as unknown as Json,
  });
  if (error) return { error: error.message };
  const d = data as { faltante_cost?: number } | null;
  const faltante = Number(d?.faltante_cost ?? 0);
  await logAdmin(
    session,
    db,
    "conteo",
    `Registró el conteo de cierre (${counts.length} ítems${faltante > 0 ? `, faltante ${money(faltante)}` : ", cuadra"})`,
    { items: counts.length, faltante },
  );
  revalidatePath(`/${session.slug}/conteo`);
  return { faltante };
}

// ---------------------------------------------------------------- Procesar insumo (crudo → procesado)
export async function procesarInsumoAction(input: {
  inputId: string;
  inputQty: number;
  outputName: string;
  outputUnits?: number | null;
}): Promise<ActionResult> {
  const { session, db } = await admin();
  if (!input.inputId || !input.inputQty || input.inputQty <= 0) {
    return { error: "Indica el insumo de origen y cuánto se usó." };
  }
  if (!input.outputName.trim()) return { error: "Indica qué salió (presa, tajada, tortilla…)." };

  // resolver/crear el insumo de salida
  const contable = input.outputUnits != null && input.outputUnits > 0;
  const { data: existing } = await db
    .from("ingredients")
    .select("id")
    .eq("restaurant_id", session.restaurant_id)
    .ilike("name", input.outputName.trim())
    .limit(1);

  let outId = existing?.[0]?.id;
  if (!outId) {
    const { data: created, error } = await db
      .from("ingredients")
      .insert({
        restaurant_id: session.restaurant_id,
        name: input.outputName.trim(),
        kind: contable ? "contable" : "granel",
        costing_method: contable ? "tanda" : "pool",
        consumption_unit: contable ? "unidad" : null,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };
    outId = created?.id;
  }
  if (!outId) return { error: "No pude registrar la salida." };

  const { error } = await db.rpc("procesar_insumo", {
    p_restaurant: session.restaurant_id,
    p_session: session.shift_session_id,
    p_user: session.user_id,
    p_date: businessDate(),
    p_input_id: input.inputId,
    p_input_qty: input.inputQty,
    p_output_id: outId,
    p_output_units: input.outputUnits ?? undefined,
  });
  if (error) return { error: error.message };
  const inputName = await nombreDe(db, "ingredients", input.inputId);
  await logAdmin(
    session,
    db,
    "procesar",
    input.outputUnits
      ? `Procesó ${input.inputQty} × ${inputName} → ${input.outputUnits} × ${input.outputName.trim()}`
      : `Procesó ${input.inputQty} × ${inputName} → ${input.outputName.trim()} (a granel)`,
    { input: inputName, input_qty: input.inputQty, output: input.outputName.trim() },
  );
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
      .select("name,last_unit_cost")
      .eq("id", input.ingredientId)
      .maybeSingle(),
  ]);
  const current = Number(stock?.stock ?? 0);
  const diff = input.newQty - current;
  const unitCost = Number(ing?.last_unit_cost ?? 0);
  const nombre = ing?.name ?? "un producto";

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
  await logAdmin(
    session,
    db,
    "ajuste_inventario",
    `Ajustó ${nombre}: de ${current} a ${input.newQty} (${diff >= 0 ? "+" : ""}${diff}) — ${input.reason}`,
    { ingredient: nombre, from: current, to: input.newQty, diff },
  );
  revalidatePath(`/${session.slug}/inventario`);
  return { ok: true };
}

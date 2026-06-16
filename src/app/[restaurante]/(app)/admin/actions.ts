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
  effectiveFrom?: string;
}): Promise<ActionResult> {
  const { session, db } = await admin();
  // Vigente desde: la fecha que elija el admin, o hoy (hora del negocio).
  const effectiveFrom = /^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom ?? "")
    ? input.effectiveFrom!
    : businessDate();
  const { error } = await db.from("recurring_costs").insert({
    restaurant_id: session.restaurant_id,
    name: input.name,
    amount: input.amount,
    category: input.category,
    schedule_type: input.scheduleType,
    day_of_month: input.dayOfMonth || null,
    effective_from: effectiveFrom,
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
  category?: string;
}): Promise<ActionResult> {
  const { session, db } = await admin();
  const { error } = await db.from("dishes").insert({
    restaurant_id: session.restaurant_id,
    name: input.name,
    price: input.price,
    category: input.category === "sopa" ? "sopa" : "principal",
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
  input: { name: string; price: number; active: boolean; category?: string },
): Promise<ActionResult> {
  const { session, db } = await admin();
  const { error } = await db
    .from("dishes")
    .update({
      name: input.name,
      price: input.price,
      active: input.active,
      ...(input.category ? { category: input.category === "sopa" ? "sopa" : "principal" } : {}),
    })
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

// ---------------------------------------------------------------- Combos (sopa + segundo)
//  Un combo es UN plato más (is_combo). El RPC arma su receta uniendo la de la
//  sopa y la del segundo, así participa en ambos pools al cerrar el día. El
//  precio del combo se fija luego en el menú del día.
export async function crearCombo(input: {
  sopaId: string;
  segundoId: string;
  name?: string;
  price?: number | null;
}): Promise<ActionResult> {
  const { session, db } = await admin();
  if (!input.sopaId || !input.segundoId) return { error: "Elige la sopa y el segundo." };
  if (input.sopaId === input.segundoId)
    return { error: "La sopa y el segundo deben ser platos distintos." };

  const { data, error } = await db.rpc("crear_combo", {
    p_restaurant: session.restaurant_id,
    p_sopa: input.sopaId,
    p_segundo: input.segundoId,
    p_name: input.name?.trim() || undefined,
    p_price: input.price ?? undefined,
    p_user: session.user_id,
  });
  if (error) return { error: error.message };
  const d = data as { name?: string } | null;
  await logAdmin(session, db, "plato_config", `Armó el combo ${d?.name ?? "nuevo"}`, {
    combo: d?.name,
  });
  revalidatePath(`/${session.slug}/catalogo`);
  return { ok: true };
}

// ---------------------------------------------------------------- Receta de un plato (insumos que lleva)
//  Asigna del inventario qué consume cada plato (proteína, pan, queso…). Los
//  contables se descuentan al vender; los granel marcan que el plato participa
//  de ese pool. Reemplaza la receta completa (borra + inserta).
export async function setReceta(
  dishId: string,
  components: { ingredientId: string; qty: number }[],
): Promise<ActionResult> {
  const { session, db } = await admin();
  await db
    .from("dish_components")
    .delete()
    .eq("restaurant_id", session.restaurant_id)
    .eq("dish_id", dishId);

  const rows = components
    .filter((c) => c.ingredientId && c.qty > 0)
    .map((c) => ({
      restaurant_id: session.restaurant_id,
      dish_id: dishId,
      ingredient_id: c.ingredientId,
      qty: c.qty,
    }));
  if (rows.length) {
    const { error } = await db.from("dish_components").insert(rows);
    if (error) return { error: error.message };
  }

  const nombre = await nombreDe(db, "dishes", dishId);
  await logAdmin(
    session,
    db,
    "receta",
    `Definió la receta de ${nombre} (${rows.length} insumo${rows.length === 1 ? "" : "s"})`,
    { dish: nombre, count: rows.length },
  );
  revalidatePath(`/${session.slug}/catalogo`);
  return { ok: true };
}

// ---------------------------------------------------------------- Adicionales (huevo extra, porción…)
//  Plato chico (is_extra) con su precio y, opcional, el insumo CONTABLE que
//  descuenta al venderse (1 huevo, 1 tajada). Si no se indica insumo, es un
//  adicional de solo ingreso (sin costo rastreado).
export async function crearAdicional(input: {
  name: string;
  price: number;
  ingredientId?: string | null;
  qty?: number | null;
}): Promise<ActionResult> {
  const { session, db } = await admin();
  if (!input.name.trim() || !(input.price > 0)) return { error: "Completa nombre y precio." };

  const { data: dish, error } = await db
    .from("dishes")
    .insert({
      restaurant_id: session.restaurant_id,
      name: input.name.trim(),
      price: input.price,
      is_extra: true,
    })
    .select("id")
    .single();
  if (error || !dish) return { error: error?.message ?? "No pude crear el adicional." };

  if (input.ingredientId) {
    const { error: ce } = await db.from("dish_components").insert({
      restaurant_id: session.restaurant_id,
      dish_id: dish.id,
      ingredient_id: input.ingredientId,
      qty: input.qty && input.qty > 0 ? input.qty : 1,
    });
    if (ce) return { error: ce.message };
  }

  await logAdmin(
    session,
    db,
    "plato_config",
    `Creó el adicional ${input.name.trim()} (${money(input.price)})`,
    { name: input.name.trim(), price: input.price },
  );
  revalidatePath(`/${session.slug}/catalogo`);
  return { ok: true };
}

// ---------------------------------------------------------------- Agregar producto al inventario (manual)
//  Contable = se cuenta por unidades (lleva stock); granel = pool (sin stock,
//  solo costo por unidad para valorar el consumo). consumoVisible decide si la
//  cocinera puede registrarlo en su gasto del día.
export async function agregarProductoInventario(input: {
  name: string;
  kind?: "contable" | "granel";
  unit?: string | null;
  qty?: number | null;
  totalCost?: number | null;
  unitCost?: number | null;
  salePrice?: number | null;
  consumoVisible?: boolean;
}): Promise<ActionResult> {
  const { session, db } = await admin();
  const name = input.name.trim();
  if (!name) return { error: "Escribe el nombre." };
  const kind = input.kind === "granel" ? "granel" : "contable";
  const unit = input.unit ?? (kind === "granel" ? "libra" : "unidad");
  const sellable = input.salePrice != null && input.salePrice > 0;

  let unitCost = 0;
  const qty = Number(input.qty) || 0;
  if (kind === "contable") {
    if (qty <= 0) return { error: "Indica la cantidad inicial." };
    unitCost = (Number(input.totalCost) || 0) / qty;
  } else {
    unitCost = Number(input.unitCost) || 0;
    if (!(unitCost > 0)) return { error: "Indica el costo por unidad." };
  }
  const consumoVisible = input.consumoVisible ?? kind === "granel";

  const { data: existing } = await db
    .from("ingredients")
    .select("id")
    .eq("restaurant_id", session.restaurant_id)
    .ilike("name", name)
    .limit(1);

  let ingId = existing?.[0]?.id;
  if (!ingId) {
    const { data: created, error } = await db
      .from("ingredients")
      .insert({
        restaurant_id: session.restaurant_id,
        name,
        kind,
        costing_method: kind === "granel" ? "pool" : "conversion",
        consumption_unit: unit,
        conversion_factor: kind === "granel" ? null : 1,
        last_unit_cost: unitCost,
        is_sellable: sellable,
        sale_price: sellable ? input.salePrice : null,
        consumo_visible: consumoVisible,
      })
      .select("id")
      .single();
    if (error) return { error: error.message };
    ingId = created?.id;
  } else {
    await db
      .from("ingredients")
      .update({
        last_unit_cost: unitCost,
        active: true,
        consumption_unit: unit,
        consumo_visible: consumoVisible,
        ...(sellable ? { is_sellable: true, sale_price: input.salePrice } : {}),
      })
      .eq("id", ingId);
  }

  // Solo el contable lleva stock; el granel valoriza al consumirse (pool).
  if (kind === "contable") {
    await db.from("inventory_movements").insert({
      restaurant_id: session.restaurant_id,
      ingredient_id: ingId!,
      shift_session_id: session.shift_session_id,
      business_date: businessDate(),
      type: "compra",
      qty,
      unit_cost: unitCost,
    });
  }

  await logAdmin(
    session,
    db,
    "producto_nuevo",
    `Agregó ${kind === "granel" ? name : `${qty} × ${name}`} al inventario`,
    { name, kind, unit },
  );

  revalidatePath(`/${session.slug}/inventario`);
  return { ok: true };
}

// ---------------------------------------------------------------- Mostrar/ocultar un insumo en "consumo"
export async function toggleConsumoVisible(input: {
  ingredientId: string;
  visible: boolean;
}): Promise<ActionResult> {
  const { session, db } = await admin();
  const { error } = await db
    .from("ingredients")
    .update({ consumo_visible: input.visible })
    .eq("id", input.ingredientId)
    .eq("restaurant_id", session.restaurant_id);
  if (error) return { error: error.message };
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

// ---------------------------------------------------------------- Merma de platos preparados no vendidos (cierre del día)
//  El admin declara cuántos platos cocinó que NO se vendieron; baja como merma
//  los insumos CONTABLES de su receta (la proteína). Lo vendido ya se descontó.
export async function registrarMermaPlatosAction(
  date: string,
  items: { dishId: string; qty: number }[],
): Promise<{ error?: string; platos?: number; total?: number }> {
  const { session, db } = await admin();
  const valid = items.filter((i) => i.dishId && i.qty > 0);
  if (valid.length === 0) return { platos: 0, total: 0 };
  const { data, error } = await db.rpc("registrar_merma_platos", {
    p_restaurant: session.restaurant_id,
    p_session: session.shift_session_id,
    p_user: session.user_id,
    p_date: date,
    p_items: valid.map((i) => ({ dish_id: i.dishId, qty: i.qty })) as unknown as Json,
  });
  if (error) return { error: error.message };
  const d = data as { platos?: number; total?: number } | null;
  await logAdmin(
    session,
    db,
    "merma",
    `Declaró ${d?.platos ?? 0} plato(s) preparados no vendidos (${money(Number(d?.total ?? 0))})`,
    { platos: d?.platos ?? 0, total: d?.total ?? 0 },
  );
  revalidatePath(`/${session.slug}/cierre-dia`);
  return { platos: Number(d?.platos ?? 0), total: Number(d?.total ?? 0) };
}

/** Valida el PIN de administradora con login_pin. Devuelve true si es admin. */
async function esPinAdmin(db: AdminDb, restaurantId: string, pin: string): Promise<boolean> {
  const { data } = await db.rpc("login_pin", { p_restaurant: restaurantId, p_pin: pin });
  const u = (data as { role?: string }[] | null)?.[0];
  return !!u && u.role === "admin";
}

// ---------------------------------------------------------------- Editar producto del inventario (con PIN)
export async function editarProductoInventario(input: {
  ingredientId: string;
  name: string;
  unitCost: number;
  salePrice?: number | null;
  newQty?: number | null;
  adjustKind?: "correccion" | "ajuste";
  reason?: string | null;
  pin: string;
}): Promise<ActionResult> {
  const { session, db } = await admin();
  if (!input.name.trim()) return { error: "El nombre no puede quedar vacío." };
  if (!(await esPinAdmin(db, session.restaurant_id, input.pin))) {
    return { error: "PIN de administradora inválido." };
  }
  if (input.newQty != null && !(input.reason ?? "").trim()) {
    return { error: "Indica el motivo del ajuste de stock." };
  }

  const { data, error } = await db.rpc("editar_producto", {
    p_restaurant: session.restaurant_id,
    p_session: session.shift_session_id,
    p_user: session.user_id,
    p_date: businessDate(),
    p_ingredient_id: input.ingredientId,
    p_name: input.name.trim(),
    p_unit_cost: input.unitCost,
    p_sale_price: input.salePrice ?? undefined,
    p_new_qty: input.newQty ?? undefined,
    p_adjust_kind: input.adjustKind ?? "correccion",
    p_reason: input.reason ?? undefined,
  });
  if (error) return { error: error.message };

  const d = data as {
    new_name?: string;
    new_cost?: number;
    stock_diff?: number;
    adjust_kind?: string;
  } | null;
  const partes = [`Editó ${d?.new_name ?? input.name.trim()}`];
  if (d?.new_cost != null) partes.push(`costo ${money(Number(d.new_cost))}`);
  if (input.salePrice != null) partes.push(`precio ${money(input.salePrice)}`);
  if (d?.stock_diff && Math.abs(Number(d.stock_diff)) > 0) {
    const diff = Number(d.stock_diff);
    partes.push(
      `stock ${diff >= 0 ? "+" : ""}${diff} (${d.adjust_kind === "ajuste" ? "conteo físico" : "corrección"})`,
    );
  }
  await logAdmin(session, db, "producto_editado", partes.join(", "), {
    ingredient: d?.new_name ?? input.name.trim(),
  });
  revalidatePath(`/${session.slug}/inventario`);
  return { ok: true };
}

// ---------------------------------------------------------------- Eliminar producto del inventario (con PIN)
export async function eliminarProductoInventario(input: {
  ingredientId: string;
  pin: string;
}): Promise<ActionResult> {
  const { session, db } = await admin();
  if (!(await esPinAdmin(db, session.restaurant_id, input.pin))) {
    return { error: "PIN de administradora inválido." };
  }
  const nombre = await nombreDe(db, "ingredients", input.ingredientId);
  const { data, error } = await db.rpc("eliminar_producto", {
    p_restaurant: session.restaurant_id,
    p_ingredient_id: input.ingredientId,
  });
  if (error) return { error: error.message };
  const d = data as { deleted?: boolean; deactivated?: boolean } | null;
  await logAdmin(
    session,
    db,
    "producto_baja",
    d?.deleted ? `Eliminó ${nombre} del inventario` : `Desactivó ${nombre} (tiene historial)`,
    { ingredient: nombre, deleted: !!d?.deleted },
  );
  revalidatePath(`/${session.slug}/inventario`);
  return d?.deleted ? { ok: true } : { error: "Tenía historial; se desactivó en lugar de borrar." };
}

// ---------------------------------------------------------------- Anular / reversar una operación (con PIN)
//  Lo puede hacer CUALQUIER usuario del turno (admin o empleada): son quienes
//  registran las ventas/compras/gastos y quienes deben poder revertir una
//  devolución o un error. Basta un PIN válido del restaurante; el reverso queda
//  firmado en la bitácora con el nombre de quien lo hizo.
export async function anularOperacion(input: {
  opId: string;
  reason: string;
  pin: string;
}): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { error: "No autorizado." };
  const db = createAdminClient();
  if (!input.reason.trim()) return { error: "El motivo es obligatorio." };

  const { data } = await db.rpc("login_pin", {
    p_restaurant: session.restaurant_id,
    p_pin: input.pin,
  });
  const actor = (data as { id: string; name: string; role: string }[] | null)?.[0];
  if (!actor) return { error: "PIN inválido." };

  const { error } = await db.rpc("anular_operacion", {
    p_restaurant: session.restaurant_id,
    p_op_id: input.opId,
    p_reason: input.reason.trim(),
    p_by: actor.id,
  });
  if (error) return { error: error.message };
  await logActivity(db, {
    restaurantId: session.restaurant_id,
    userId: actor.id,
    actorName: actor.name,
    shiftSessionId: session.shift_session_id,
    source: "manual",
    event: "anulacion",
    description: `Anuló una operación — ${input.reason.trim()}`,
    metadata: { op_id: input.opId, role: actor.role },
    opId: input.opId,
  });
  revalidatePath(`/${session.slug}/reversar`);
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

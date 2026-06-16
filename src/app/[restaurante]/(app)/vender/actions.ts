"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth/session";
import { businessDate } from "@/lib/shifts";
import { logActivity } from "@/lib/activity";
import type { Database, Json } from "@/lib/supabase/database.types";

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

/** Una línea del carrito: un plato del menú o un producto vendible del inventario. */
export interface VentaLinea {
  kind: "plato" | "producto";
  id: string;
  name: string;
  unitPrice: number;
  qty: number;
}

export interface VentaResult {
  error?: string;
  ok?: boolean;
  total?: number;
  count?: number;
  note?: string;
}

/**
 * Registra el carrito de venta. Cada línea se guarda como su propia venta
 * (reusa el RPC registrar_venta: descuenta inventario, estampa op_id reversible
 * y deja audit_log). Todo va en EFECTIVO y SERVIR — el envase para llevar se
 * cobra como un adicional aparte (que descuenta su propio insumo).
 */
export async function registrarVenta(lineas: VentaLinea[]): Promise<VentaResult> {
  const session = await getSession();
  if (!session) return { error: "Sesión expirada. Vuelve a entrar." };

  const items = (lineas ?? []).filter(
    (l) => l && l.id && l.qty > 0 && l.unitPrice >= 0,
  );
  if (items.length === 0) return { error: "Agrega al menos un plato antes de registrar." };

  const db = createAdminClient();
  let total = 0;

  for (const it of items) {
    const { data, error } = await db.rpc("registrar_venta", {
      p_restaurant: session.restaurant_id,
      p_session: session.shift_session_id,
      p_user: session.user_id,
      p_date: businessDate(),
      p_item_kind: it.kind,
      p_dish_id: it.kind === "plato" ? it.id : null,
      p_ingredient_id: it.kind === "producto" ? it.id : null,
      p_name: it.name,
      p_qty: it.qty,
      p_unit_price: it.unitPrice,
      p_service_type: "servir",
      p_payment_method: "efectivo",
      p_packaging_id: null,
    } as unknown as Database["public"]["Functions"]["registrar_venta"]["Args"]);
    if (error) return { error: error.message };

    const d = data as { total?: number; op_id?: string } | null;
    const lineTotal = Number(d?.total ?? it.unitPrice * it.qty);
    total += lineTotal;

    await logActivity(db, {
      restaurantId: session.restaurant_id,
      userId: session.user_id,
      actorName: session.user_name,
      shiftSessionId: session.shift_session_id,
      source: "manual",
      event: "venta",
      description: `Venta: ${it.qty} × ${it.name} = ${money(lineTotal)} (efectivo)`,
      metadata: {
        item: it.name,
        qty: it.qty,
        total: lineTotal,
        payment_method: "efectivo",
        item_kind: it.kind,
      },
      opId: d?.op_id ?? null,
    });
  }

  revalidatePath(`/${session.slug}/hoy`);
  return { ok: true, total, count: items.length };
}

/**
 * Consumo de empleado (comida gratis del personal). Cada PLATO del carrito se
 * registra a $0 con `registrar_consumo_interno`: descuenta su proteína del
 * inventario (sí es un costo del día) pero NO es ingreso y NO toca la caja del
 * turno, así que no afecta el cuadre de las chicas. Los productos de inventario
 * (colas, aguas) aún no entran aquí — llegan con las cuentas por cobrar.
 */
export async function registrarConsumoEmpleado(lineas: VentaLinea[]): Promise<VentaResult> {
  const session = await getSession();
  if (!session) return { error: "Sesión expirada. Vuelve a entrar." };

  const todo = (lineas ?? []).filter((l) => l && l.id && l.qty > 0);
  const platos = todo.filter((l) => l.kind === "plato");
  const productos = todo.filter((l) => l.kind === "producto").length;
  if (platos.length === 0)
    return { error: "El consumo de empleado es solo para platos del menú por ahora." };

  const db = createAdminClient();
  let count = 0;

  for (const it of platos) {
    const { data, error } = await db.rpc("registrar_consumo_interno", {
      p_restaurant: session.restaurant_id,
      p_session: session.shift_session_id,
      p_user: session.user_id,
      p_date: businessDate(),
      p_dish_id: it.id,
      p_name: it.name,
      p_qty: it.qty,
    });
    if (error) return { error: error.message };

    const opId = (data as { op_id?: string } | null)?.op_id ?? null;
    await logActivity(db, {
      restaurantId: session.restaurant_id,
      userId: session.user_id,
      actorName: session.user_name,
      shiftSessionId: session.shift_session_id,
      source: "manual",
      event: "consumo",
      description: `Consumo de empleado: ${it.qty} × ${it.name} (${session.user_name})`,
      metadata: { dish: it.name, qty: it.qty, interno: true },
      opId,
    });
    count += it.qty;
  }

  revalidatePath(`/${session.slug}/hoy`);
  const platosTxt = `${count} plato${count === 1 ? "" : "s"}`;
  return {
    ok: true,
    count,
    note: productos > 0 ? `${platosTxt} · las colas/productos no se incluyen aún` : platosTxt,
  };
}

// ===========================================================================
//  VENTA A CRÉDITO (fiado) — a nombre de un cliente/empleado registrado.
//  Cuenta la ganancia y el costo (descuenta inventario) pero va con método
//  'credito' → NO entra a la caja del turno (no afecta el cuadre). El cobro se
//  hace después en el módulo "Cuentas por cobrar".
// ===========================================================================
export async function registrarVentaCredito(
  lineas: VentaLinea[],
  clienteId: string,
): Promise<VentaResult> {
  const session = await getSession();
  if (!session) return { error: "Sesión expirada. Vuelve a entrar." };
  if (!clienteId) return { error: "Elige a quién se le fía." };

  const items = (lineas ?? []).filter((l) => l && l.id && l.qty > 0 && l.unitPrice >= 0);
  if (items.length === 0) return { error: "Agrega al menos un plato antes de fiar." };

  const db = createAdminClient();
  let total = 0;

  for (const it of items) {
    const { data, error } = await db.rpc("registrar_venta_credito", {
      p_restaurant: session.restaurant_id,
      p_session: session.shift_session_id,
      p_user: session.user_id,
      p_date: businessDate(),
      p_cliente_id: clienteId,
      p_item_kind: it.kind,
      p_dish_id: it.kind === "plato" ? it.id : null,
      p_ingredient_id: it.kind === "producto" ? it.id : null,
      p_name: it.name,
      p_qty: it.qty,
      p_unit_price: it.unitPrice,
      p_service_type: "servir",
    } as unknown as Database["public"]["Functions"]["registrar_venta_credito"]["Args"]);
    if (error) return { error: error.message };

    const d = data as { total?: number; op_id?: string } | null;
    const lineTotal = Number(d?.total ?? it.unitPrice * it.qty);
    total += lineTotal;

    await logActivity(db, {
      restaurantId: session.restaurant_id,
      userId: session.user_id,
      actorName: session.user_name,
      shiftSessionId: session.shift_session_id,
      source: "manual",
      event: "venta",
      description: `Venta a crédito: ${it.qty} × ${it.name} = ${money(lineTotal)} (fiado)`,
      metadata: { item: it.name, qty: it.qty, total: lineTotal, credito: true, cliente_id: clienteId },
      opId: d?.op_id ?? null,
    });
  }

  revalidatePath(`/${session.slug}/hoy`);
  revalidatePath(`/${session.slug}/cuentas-por-cobrar`);
  return { ok: true, total, count: items.length };
}

// ===========================================================================
//  CUENTAS DE MESA ("Guardar cuenta") — borrador en la base, no descuenta nada
//  hasta cobrar. Se puede agregar/editar/eliminar; al cobrar corre el RPC
//  atómico cobrar_cuenta_mesa (venta real, efectivo por defecto).
// ===========================================================================
interface CuentaItem {
  kind: "plato" | "producto";
  ref_id: string;
  name: string;
  unit_price: number;
  qty: number;
}

function toItems(lineas: VentaLinea[]): CuentaItem[] {
  return (lineas ?? [])
    .filter((l) => l && l.id && l.qty > 0)
    .map((l) => ({ kind: l.kind, ref_id: l.id, name: l.name, unit_price: l.unitPrice, qty: l.qty }));
}
const itemsTotal = (items: CuentaItem[]) =>
  items.reduce((s, i) => s + i.unit_price * i.qty, 0);

export interface CuentaResult extends VentaResult {
  cuentaId?: string;
}

/** Guarda una cuenta nueva (borrador). No toca inventario ni caja. */
export async function guardarCuenta(
  label: string,
  lineas: VentaLinea[],
): Promise<CuentaResult> {
  const session = await getSession();
  if (!session) return { error: "Sesión expirada. Vuelve a entrar." };
  const items = toItems(lineas);
  if (items.length === 0) return { error: "Agrega al menos un producto a la cuenta." };
  const total = itemsTotal(items);

  const db = createAdminClient();
  const { data, error } = await db
    .from("cuentas_mesa")
    .insert({
      restaurant_id: session.restaurant_id,
      shift_session_id: session.shift_session_id,
      business_date: businessDate(),
      label: label.trim() || "Mesa",
      items: items as unknown as Json,
      total,
      created_by: session.user_id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  revalidatePath(`/${session.slug}/vender`);
  return { ok: true, total, count: items.length, cuentaId: data?.id };
}

/** Reemplaza los ítems/etiqueta de una cuenta abierta (agregar/quitar). */
export async function actualizarCuenta(
  cuentaId: string,
  label: string,
  lineas: VentaLinea[],
): Promise<CuentaResult> {
  const session = await getSession();
  if (!session) return { error: "Sesión expirada. Vuelve a entrar." };
  const items = toItems(lineas);
  if (items.length === 0)
    return { error: "La cuenta no puede quedar vacía. Si no se usará, elimínala." };
  const total = itemsTotal(items);

  const db = createAdminClient();
  const { error } = await db
    .from("cuentas_mesa")
    .update({
      label: label.trim() || "Mesa",
      items: items as unknown as Json,
      total,
      updated_at: new Date().toISOString(),
    })
    .eq("id", cuentaId)
    .eq("restaurant_id", session.restaurant_id)
    .eq("status", "abierta");
  if (error) return { error: error.message };

  revalidatePath(`/${session.slug}/vender`);
  return { ok: true, total, count: items.length, cuentaId };
}

/** Cobra la cuenta: la vuelve venta real (descuenta inventario, entra a caja). */
export async function cobrarCuenta(
  cuentaId: string,
  paymentMethod: "efectivo" | "transferencia" | "otro" = "efectivo",
): Promise<VentaResult> {
  const session = await getSession();
  if (!session) return { error: "Sesión expirada. Vuelve a entrar." };

  const db = createAdminClient();
  const { data, error } = await db.rpc("cobrar_cuenta_mesa", {
    p_restaurant: session.restaurant_id,
    p_session: session.shift_session_id,
    p_user: session.user_id,
    p_date: businessDate(),
    p_cuenta_id: cuentaId,
    p_payment_method: paymentMethod,
  });
  if (error) return { error: error.message };

  const d = data as { total?: number; count?: number; op_id?: string } | null;
  await logActivity(db, {
    restaurantId: session.restaurant_id,
    userId: session.user_id,
    actorName: session.user_name,
    shiftSessionId: session.shift_session_id,
    source: "manual",
    event: "venta",
    description: `Cobró una cuenta de mesa: ${money(Number(d?.total ?? 0))} (${Number(d?.count ?? 0)} ítems)`,
    metadata: { mesa: true, total: Number(d?.total ?? 0), count: Number(d?.count ?? 0) },
    opId: d?.op_id ?? null,
  });

  revalidatePath(`/${session.slug}/vender`);
  revalidatePath(`/${session.slug}/hoy`);
  return { ok: true, total: Number(d?.total ?? 0), count: Number(d?.count ?? 0) };
}

/** Descarta una cuenta abierta (no pasó nada en inventario/caja). */
export async function eliminarCuenta(cuentaId: string): Promise<VentaResult> {
  const session = await getSession();
  if (!session) return { error: "Sesión expirada. Vuelve a entrar." };
  const db = createAdminClient();
  const { error } = await db
    .from("cuentas_mesa")
    .update({ status: "anulada", updated_at: new Date().toISOString() })
    .eq("id", cuentaId)
    .eq("restaurant_id", session.restaurant_id)
    .eq("status", "abierta");
  if (error) return { error: error.message };
  revalidatePath(`/${session.slug}/vender`);
  return { ok: true };
}

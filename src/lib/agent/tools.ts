import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { SessionClaims } from "@/lib/auth/jwt";
import { businessDate } from "@/lib/shifts";
import { menuShiftIds, dedupeMenu } from "@/lib/menu";
import { logActivity, type EventCode } from "@/lib/activity";

export type Db = SupabaseClient<Database>;
export interface ToolCtx {
  db: Db;
  session: SessionClaims;
}
export interface ToolResult {
  message: string;
  loggedOut?: boolean;
}

interface Tool {
  name: string;
  mode: "read" | "write";
  description: string;
  parameters: Record<string, unknown>; // schema estilo Gemini
  validate: (raw: unknown) => Record<string, unknown>;
  preview?: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<string>;
  execute: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<ToolResult>;
}

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

// ---------------------------------------------------------------------------
//  Resolvers (solo lectura) — todo gira alrededor de registrar una venta.
//  Los PLATOS solo se reconocen si están en el MENÚ DE HOY (no en el catálogo
//  general). Las BEBIDAS/PRODUCTOS vendibles del inventario sí se venden directo.
// ---------------------------------------------------------------------------

/** Producto del inventario vendible directo (cola, agua…). */
async function resolveSellableProduct(ctx: ToolCtx, name: string) {
  const { data } = await ctx.db
    .from("ingredients")
    .select("id,name,sale_price")
    .eq("restaurant_id", ctx.session.restaurant_id)
    .eq("is_sellable", true)
    .eq("active", true)
    .ilike("name", `%${name}%`)
    .limit(1);
  return data?.[0] ?? null;
}

/**
 * Adicional (huevo extra, tortilla de verde, porción…): plato con is_extra=true.
 * Está SIEMPRE disponible para la venta aunque no esté en el menú del día (igual
 * que en el módulo manual, que los lista todos, no solo los del menú).
 */
async function resolveExtraDish(ctx: ToolCtx, name: string) {
  const { data } = await ctx.db
    .from("dishes")
    .select("id,name,price")
    .eq("restaurant_id", ctx.session.restaurant_id)
    .eq("is_extra", true)
    .eq("active", true)
    .ilike("name", `%${name}%`)
    .limit(1);
  return data?.[0] ?? null;
}

/** Platos del menú de HOY del turno actual (incluye los de "Todo el día"). */
async function todayMenu(ctx: ToolCtx) {
  const shiftIds = await menuShiftIds(
    ctx.db,
    ctx.session.restaurant_id,
    ctx.session.shift_id,
  );
  const { data } = await ctx.db
    .from("daily_menu")
    .select("id,dish_id,shift_id,price,available,dishes(id,name,is_extra)")
    .eq("restaurant_id", ctx.session.restaurant_id)
    .eq("business_date", businessDate())
    .in("shift_id", shiftIds)
    .order("sort_order");
  return dedupeMenu(data ?? [], ctx.session.shift_id).map((m) => {
    const d = m.dishes as unknown as { id: string; name: string; is_extra: boolean } | null;
    return {
      menuId: m.id,
      price: Number(m.price),
      available: m.available,
      isExtra: !!d?.is_extra,
      dishId: d?.id ?? null,
      name: d?.name ?? "",
    };
  });
}

/** Una línea de venta ya resuelta a un plato/producto real con su precio. */
interface ResolvedLine {
  kind: "plato" | "producto";
  id: string;
  name: string;
  unitPrice: number;
  qty: number;
  /** Plato que ESTÁ en el menú de hoy pero marcado agotado (hay que reactivarlo). */
  agotado?: boolean;
}

/**
 * Resuelve lo que se vende: primero un PRODUCTO vendible del inventario (cola,
 * agua), si no, un PLATO del MENÚ DE HOY. NO cae al catálogo general: si el plato
 * no está en el menú de hoy, devuelve null para que se pida aclarar el nombre.
 * Si el plato está en el menú pero agotado, lo marca para reactivar al confirmar.
 */
async function resolveSaleTarget(
  ctx: ToolCtx,
  name: string,
  unitPrice?: number,
): Promise<ResolvedLine | null> {
  const prod = await resolveSellableProduct(ctx, name);
  if (prod) {
    const sp = Number(prod.sale_price ?? 0);
    const price = unitPrice ?? (sp > 0 ? sp : null);
    if (price == null) return null;
    return { kind: "producto", id: prod.id, name: prod.name, unitPrice: price, qty: 1 };
  }
  const menu = await todayMenu(ctx);
  const m = menu.find((x) => x.dishId && x.name.toLowerCase().includes(name.toLowerCase()));
  if (m && m.dishId) {
    return {
      kind: "plato",
      id: m.dishId,
      name: m.name,
      unitPrice: unitPrice ?? m.price,
      qty: 1,
      agotado: !m.available,
    };
  }
  // Adicionales: siempre disponibles aunque no estén en el menú de hoy.
  const ad = await resolveExtraDish(ctx, name);
  if (ad) {
    return { kind: "plato", id: ad.id, name: ad.name, unitPrice: unitPrice ?? Number(ad.price), qty: 1 };
  }
  return null;
}

/** Nombres de platos agotados en una lista (para avisar antes de confirmar). */
const agotadoNote = (lines: ResolvedLine[]): string => {
  const a = lines.filter((l) => l.agotado).map((l) => l.name);
  return a.length ? ` (${a.join(", ")} estaba agotado hoy — lo reactivo y registro)` : "";
};

/** Reactiva en el menú de hoy los platos que estaban agotados antes de venderlos. */
async function reactivarPlatos(ctx: ToolCtx, dishIds: string[]) {
  if (dishIds.length === 0) return;
  const shiftIds = await menuShiftIds(
    ctx.db,
    ctx.session.restaurant_id,
    ctx.session.shift_id,
  );
  await ctx.db
    .from("daily_menu")
    .update({ available: true })
    .eq("restaurant_id", ctx.session.restaurant_id)
    .eq("business_date", businessDate())
    .in("shift_id", shiftIds)
    .in("dish_id", dishIds);
}
const agotadoIds = (lines: ResolvedLine[]): string[] =>
  lines.filter((l) => l.kind === "plato" && l.agotado).map((l) => l.id);

/** Resuelve una lista hablada de ítems (nombre + cantidad) a líneas de venta. */
interface ItemInput {
  name: string;
  qty: number;
  unit_price?: number;
}
async function resolveItems(
  ctx: ToolCtx,
  items: ItemInput[],
): Promise<{ lines: ResolvedLine[]; missing: string[] }> {
  const lines: ResolvedLine[] = [];
  const missing: string[] = [];
  for (const it of items) {
    const t = await resolveSaleTarget(ctx, it.name, it.unit_price);
    if (!t) {
      missing.push(it.name);
      continue;
    }
    lines.push({ ...t, qty: it.qty });
  }
  return { lines, missing };
}

const NUM_WORDS: Record<string, string> = {
  uno: "1", una: "1", dos: "2", tres: "3", cuatro: "4", cinco: "5",
  seis: "6", siete: "7", ocho: "8", nueve: "9", diez: "10",
  once: "11", doce: "12", trece: "13", catorce: "14", quince: "15",
};

/** Cliente/empleado registrado para venta a crédito (debe existir y estar activo). */
async function resolveCliente(ctx: ToolCtx, name: string) {
  const { data } = await ctx.db
    .from("clientes")
    .select("id,name,kind")
    .eq("restaurant_id", ctx.session.restaurant_id)
    .eq("active", true)
    .ilike("name", `%${name.trim()}%`)
    .limit(1);
  return data?.[0] ?? null;
}

interface CuentaItem {
  kind: "plato" | "producto";
  ref_id: string;
  name: string;
  unit_price: number;
  qty: number;
}
interface CuentaRow {
  id: string;
  label: string;
  items: CuentaItem[];
  total: number;
}

/** Encuentra una cuenta/mesa ABIERTA por su etiqueta hablada ("mesa 2", "mesa dos"). */
async function resolveCuenta(ctx: ToolCtx, mesa: string): Promise<CuentaRow | null> {
  const { data } = await ctx.db
    .from("cuentas_mesa")
    .select("id,label,items,total")
    .eq("restaurant_id", ctx.session.restaurant_id)
    .eq("status", "abierta")
    .order("created_at");
  const rows = ((data ?? []) as unknown as {
    id: string;
    label: string;
    items: Json;
    total: number;
  }[]).map((r) => ({
    id: r.id,
    label: r.label,
    items: ((r.items as unknown as CuentaItem[]) ?? []),
    total: Number(r.total),
  }));
  if (rows.length === 0) return null;

  let q = mesa.trim().toLowerCase();
  // "mesa dos" → "mesa 2" para emparejar con las etiquetas en dígitos.
  for (const [w, d] of Object.entries(NUM_WORDS)) {
    q = q.replace(new RegExp(`\\b${w}\\b`, "g"), d);
  }
  // 1) etiqueta exacta
  let m = rows.find((r) => r.label.toLowerCase() === q);
  // 2) mismo número final ("mesa 2" ↔ "Mesa 2")
  if (!m) {
    const num = q.match(/(\d+)/)?.[1];
    if (num) m = rows.find((r) => r.label.match(/(\d+)/)?.[1] === num);
  }
  // 3) contiene el texto
  if (!m) m = rows.find((r) => r.label.toLowerCase().includes(q));
  return m ?? null;
}

const toCuentaItems = (lines: ResolvedLine[]): CuentaItem[] =>
  lines.map((l) => ({
    kind: l.kind,
    ref_id: l.id,
    name: l.name,
    unit_price: l.unitPrice,
    qty: l.qty,
  }));
const itemsTotal = (items: { unit_price: number; qty: number }[]) =>
  items.reduce((s, i) => s + i.unit_price * i.qty, 0);
const linesTotal = (lines: ResolvedLine[]) =>
  lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
const listLines = (lines: { name: string; qty: number }[]) =>
  lines.map((l) => `${l.qty} × ${l.name}`).join(", ");

/** Registra el evento en la bitácora (toda acción de la IA es source 'ia'). */
async function logEvent(
  ctx: ToolCtx,
  event: EventCode,
  description: string,
  metadata?: Record<string, unknown>,
  opId?: string | null,
) {
  await logActivity(ctx.db, {
    restaurantId: ctx.session.restaurant_id,
    userId: ctx.session.user_id,
    actorName: ctx.session.user_name,
    shiftSessionId: ctx.session.shift_session_id,
    source: "ia",
    event,
    description,
    metadata,
    opId,
  });
}

// ---------------------------------------------------------------------------
//  Esquemas
// ---------------------------------------------------------------------------
const itemSchema = z.object({
  name: z.string().min(1),
  qty: z.coerce.number().int().positive().default(1),
  unit_price: z.coerce.number().positive().optional(),
});
const itemsParam = {
  type: "ARRAY",
  description: "Platos, adicionales o productos vendidos, con su cantidad.",
  items: {
    type: "OBJECT",
    properties: {
      name: { type: "STRING", description: "Nombre del plato, adicional o producto" },
      qty: { type: "INTEGER", description: "Cantidad (por defecto 1)" },
      unit_price: { type: "NUMBER", description: "Precio unitario solo si no está en el menú" },
    },
    required: ["name"],
  },
};

const ventaSchema = z.object({ items: z.array(itemSchema).min(1) });
const creditoSchema = z.object({
  cliente_name: z.string().min(1),
  items: z.array(itemSchema).min(1),
});
const consumoSchema = z.object({ items: z.array(itemSchema).min(1) });
const crearCuentaSchema = z.object({
  label: z.string().optional(),
  items: z.array(itemSchema).min(1),
});
const cambioSchema = z.object({
  name: z.string().min(1),
  qty: z.coerce.number().int().positive().optional(),
  op: z.enum(["agregar", "quitar", "fijar"]).default("agregar"),
});
const modificarCuentaSchema = z.object({
  mesa: z.string().min(1),
  cambios: z.array(cambioSchema).min(1),
});
const cobrarCuentaSchema = z.object({ mesa: z.string().min(1) });
const eliminarCuentaSchema = z.object({ mesa: z.string().min(1) });

/** Aplica los cambios hablados a los ítems actuales de una cuenta. */
async function applyCambios(
  ctx: ToolCtx,
  cuenta: CuentaRow,
  cambios: z.infer<typeof cambioSchema>[],
): Promise<{ items: CuentaItem[]; missing: string[]; reactivar: { id: string; name: string }[] }> {
  const items = cuenta.items.map((i) => ({ ...i }));
  const missing: string[] = [];
  const reactivar: { id: string; name: string }[] = [];
  for (const c of cambios) {
    const t = await resolveSaleTarget(ctx, c.name);
    if (!t) {
      missing.push(c.name);
      continue;
    }
    const idx = items.findIndex((i) => i.kind === t.kind && i.ref_id === t.id);
    if (c.op === "quitar") {
      if (idx === -1) continue;
      if (c.qty == null) items.splice(idx, 1);
      else {
        items[idx].qty -= c.qty;
        if (items[idx].qty <= 0) items.splice(idx, 1);
      }
    } else if (c.op === "fijar") {
      const qty = c.qty ?? 1;
      if (idx === -1)
        items.push({ kind: t.kind, ref_id: t.id, name: t.name, unit_price: t.unitPrice, qty });
      else items[idx].qty = qty;
      if (t.kind === "plato" && t.agotado) reactivar.push({ id: t.id, name: t.name });
    } else {
      // agregar
      const qty = c.qty ?? 1;
      if (idx === -1)
        items.push({ kind: t.kind, ref_id: t.id, name: t.name, unit_price: t.unitPrice, qty });
      else items[idx].qty += qty;
      if (t.kind === "plato" && t.agotado) reactivar.push({ id: t.id, name: t.name });
    }
  }
  return { items, missing, reactivar };
}

// ---------------------------------------------------------------------------
//  Herramientas — SOLO el módulo de registrar venta.
// ---------------------------------------------------------------------------
export const TOOLS: Record<string, Tool> = {
  // ============================ VENTA AL CONTADO ===========================
  registrar_venta: {
    name: "registrar_venta",
    mode: "write",
    description:
      "Registra una venta cobrada al CONTADO (efectivo). Acepta varios ítems en una sola venta: platos del menú, adicionales (huevo extra, porción) y productos del inventario (cola, agua). Úsalo para 'vende un seco con una cola', 'cobra 2 almuerzos y un huevo extra'.",
    parameters: {
      type: "OBJECT",
      properties: { items: itemsParam },
      required: ["items"],
    },
    validate: (raw) => ventaSchema.parse(raw),
    preview: async (args, ctx) => {
      const a = ventaSchema.parse(args);
      const { lines, missing } = await resolveItems(ctx, a.items);
      if (missing.length)
        throw new Error(`No encontré en el menú de hoy: ${missing.join(", ")}. Dime bien el nombre o a cuál plato del menú te refieres.`);
      return `Registrar venta (efectivo): ${listLines(lines)} = ${money(linesTotal(lines))}.${agotadoNote(lines)} ¿Confirmo?`;
    },
    execute: async (args, ctx) => {
      const a = ventaSchema.parse(args);
      const { lines, missing } = await resolveItems(ctx, a.items);
      if (missing.length)
        throw new Error(`No encontré en el menú de hoy: ${missing.join(", ")}. Dime bien el nombre o a cuál plato del menú te refieres.`);
      await reactivarPlatos(ctx, agotadoIds(lines));
      let total = 0;
      for (const it of lines) {
        const { data, error } = await ctx.db.rpc("registrar_venta", {
          p_restaurant: ctx.session.restaurant_id,
          p_session: ctx.session.shift_session_id,
          p_user: ctx.session.user_id,
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
        if (error) throw new Error(error.message);
        const d = data as { total?: number; op_id?: string } | null;
        const lineTotal = Number(d?.total ?? it.unitPrice * it.qty);
        total += lineTotal;
        await logEvent(
          ctx,
          "venta",
          `Venta: ${it.qty} × ${it.name} = ${money(lineTotal)} (efectivo)`,
          { item: it.name, qty: it.qty, total: lineTotal, payment_method: "efectivo", item_kind: it.kind },
          d?.op_id ?? null,
        );
      }
      return { message: `✅ Venta registrada: ${listLines(lines)} = ${money(total)}.` };
    },
  },

  // ============================ VENTA A CRÉDITO ============================
  registrar_credito: {
    name: "registrar_credito",
    mode: "write",
    description:
      "Registra una venta a CRÉDITO (fiado) a nombre de una persona YA registrada. Úsalo para 'fíale un almuerzo a Juan', 'anota a crédito 2 colas a María'. La persona debe existir; si no la encuentras, dilo y NO inventes. No entra a la caja del turno; se cobra después.",
    parameters: {
      type: "OBJECT",
      properties: {
        cliente_name: { type: "STRING", description: "Nombre de la persona a quien se le fía" },
        items: itemsParam,
      },
      required: ["cliente_name", "items"],
    },
    validate: (raw) => creditoSchema.parse(raw),
    preview: async (args, ctx) => {
      const a = creditoSchema.parse(args);
      const cliente = await resolveCliente(ctx, a.cliente_name);
      if (!cliente)
        throw new Error(`No tengo registrada a «${a.cliente_name}». Regístrala primero en Clientes.`);
      const { lines, missing } = await resolveItems(ctx, a.items);
      if (missing.length)
        throw new Error(`No encontré en el menú de hoy: ${missing.join(", ")}. Dime bien el nombre o a cuál plato del menú te refieres.`);
      return `Fiar a «${cliente.name}»: ${listLines(lines)} = ${money(linesTotal(lines))} (queda por cobrar).${agotadoNote(lines)} ¿Confirmo?`;
    },
    execute: async (args, ctx) => {
      const a = creditoSchema.parse(args);
      const cliente = await resolveCliente(ctx, a.cliente_name);
      if (!cliente)
        throw new Error(`No tengo registrada a «${a.cliente_name}». Regístrala primero en Clientes.`);
      const { lines, missing } = await resolveItems(ctx, a.items);
      if (missing.length)
        throw new Error(`No encontré en el menú de hoy: ${missing.join(", ")}. Dime bien el nombre o a cuál plato del menú te refieres.`);
      await reactivarPlatos(ctx, agotadoIds(lines));
      let total = 0;
      for (const it of lines) {
        const { data, error } = await ctx.db.rpc("registrar_venta_credito", {
          p_restaurant: ctx.session.restaurant_id,
          p_session: ctx.session.shift_session_id,
          p_user: ctx.session.user_id,
          p_date: businessDate(),
          p_cliente_id: cliente.id,
          p_item_kind: it.kind,
          p_dish_id: it.kind === "plato" ? it.id : null,
          p_ingredient_id: it.kind === "producto" ? it.id : null,
          p_name: it.name,
          p_qty: it.qty,
          p_unit_price: it.unitPrice,
          p_service_type: "servir",
        } as unknown as Database["public"]["Functions"]["registrar_venta_credito"]["Args"]);
        if (error) throw new Error(error.message);
        const d = data as { total?: number; op_id?: string } | null;
        const lineTotal = Number(d?.total ?? it.unitPrice * it.qty);
        total += lineTotal;
        await logEvent(
          ctx,
          "venta",
          `Venta a crédito: ${it.qty} × ${it.name} = ${money(lineTotal)} (fiado a ${cliente.name})`,
          { item: it.name, qty: it.qty, total: lineTotal, credito: true, cliente_id: cliente.id },
          d?.op_id ?? null,
        );
      }
      return { message: `✅ Fiado a ${cliente.name}: ${listLines(lines)} = ${money(total)}.` };
    },
  },

  // ============================ CONSUMO PROPIO =============================
  consumo_propio: {
    name: "consumo_propio",
    mode: "write",
    description:
      "Registra la COMIDA GRATIS de una empleada (consumo propio): ej. 'voy a comer mi almuerzo', 'me sirvo un seco de pollo'. SOLO se permite el PLATO PRINCIPAL del día, gratis. Las bebidas/colas y los adicionales NO son gratis: esos van como venta normal. Se registra a $0 a nombre de quien habla.",
    parameters: {
      type: "OBJECT",
      properties: { items: itemsParam },
      required: ["items"],
    },
    validate: (raw) => consumoSchema.parse(raw),
    preview: async (args, ctx) => {
      const a = consumoSchema.parse(args);
      const { allowed, rejected } = await splitConsumo(ctx, a.items);
      if (allowed.length === 0)
        throw new Error("El consumo de empleada es solo para el plato principal (no adicionales ni bebidas).");
      const nota = rejected.length ? ` (No incluye: ${rejected.join(", ")} — solo el plato principal es gratis)` : "";
      return `Consumo de empleada (${ctx.session.user_name}): ${listLines(allowed)}, gratis.${nota} ¿Confirmo?`;
    },
    execute: async (args, ctx) => {
      const a = consumoSchema.parse(args);
      const { allowed, rejected } = await splitConsumo(ctx, a.items);
      if (allowed.length === 0)
        throw new Error("El consumo de empleada es solo para el plato principal (no adicionales ni bebidas).");
      for (const it of allowed) {
        const { data, error } = await ctx.db.rpc("registrar_consumo_interno", {
          p_restaurant: ctx.session.restaurant_id,
          p_session: ctx.session.shift_session_id,
          p_user: ctx.session.user_id,
          p_date: businessDate(),
          p_dish_id: it.id,
          p_name: it.name,
          p_qty: it.qty,
        });
        if (error) throw new Error(error.message);
        await logEvent(
          ctx,
          "consumo",
          `Consumo de empleada: ${it.qty} × ${it.name} (${ctx.session.user_name})`,
          { dish: it.name, qty: it.qty, interno: true },
          (data as { op_id?: string } | null)?.op_id ?? null,
        );
      }
      const nota = rejected.length ? ` (no incluí: ${rejected.join(", ")})` : "";
      return { message: `✅ Consumo de ${ctx.session.user_name}: ${listLines(allowed)}.${nota}` };
    },
  },

  // ===================== CUENTAS POR COBRAR (MESAS) ========================
  crear_cuenta: {
    name: "crear_cuenta",
    mode: "write",
    description:
      "Crea una cuenta/mesa PENDIENTE DE COBRO (no cobra ni descuenta nada todavía). Úsalo para 'abre la mesa 3 con 2 secos y una cola', 'registra a la mesa 1 un almuerzo'. La cobras luego con cobrar_cuenta.",
    parameters: {
      type: "OBJECT",
      properties: {
        label: { type: "STRING", description: "Nombre de la mesa/cuenta (ej. 'Mesa 3')" },
        items: itemsParam,
      },
      required: ["items"],
    },
    validate: (raw) => crearCuentaSchema.parse(raw),
    preview: async (args, ctx) => {
      const a = crearCuentaSchema.parse(args);
      const { lines, missing } = await resolveItems(ctx, a.items);
      if (missing.length)
        throw new Error(`No encontré en el menú de hoy: ${missing.join(", ")}. Dime bien el nombre o a cuál plato del menú te refieres.`);
      return `Crear cuenta «${a.label?.trim() || "Mesa"}»: ${listLines(lines)} = ${money(linesTotal(lines))} (pendiente de cobro).${agotadoNote(lines)} ¿Confirmo?`;
    },
    execute: async (args, ctx) => {
      const a = crearCuentaSchema.parse(args);
      const { lines, missing } = await resolveItems(ctx, a.items);
      if (missing.length)
        throw new Error(`No encontré en el menú de hoy: ${missing.join(", ")}. Dime bien el nombre o a cuál plato del menú te refieres.`);
      await reactivarPlatos(ctx, agotadoIds(lines));
      const items = toCuentaItems(lines);
      const total = itemsTotal(items);
      const label = a.label?.trim() || "Mesa";
      const { error } = await ctx.db.from("cuentas_mesa").insert({
        restaurant_id: ctx.session.restaurant_id,
        shift_session_id: ctx.session.shift_session_id,
        business_date: businessDate(),
        label,
        items: items as unknown as Json,
        total,
        created_by: ctx.session.user_id,
      });
      if (error) throw new Error(error.message);
      await logEvent(ctx, "venta", `Abrió la cuenta «${label}» (${money(total)}, pendiente de cobro)`, {
        mesa: true,
        label,
        total,
        count: items.length,
      });
      return { message: `✅ Cuenta «${label}» abierta: ${listLines(lines)} = ${money(total)}.` };
    },
  },

  modificar_cuenta: {
    name: "modificar_cuenta",
    mode: "write",
    description:
      "Modifica una cuenta/mesa abierta: agrega ítems, quita ítems o fija una cantidad. Úsalo para 'a la mesa 2 agrégale una cola', 'quita el huevo de la mesa 1', 'en la mesa 3 pon 2 colas en vez de 1' (op='fijar', qty=2).",
    parameters: {
      type: "OBJECT",
      properties: {
        mesa: { type: "STRING", description: "Mesa/cuenta a modificar (ej. 'Mesa 2')" },
        cambios: {
          type: "ARRAY",
          description: "Cambios a aplicar.",
          items: {
            type: "OBJECT",
            properties: {
              name: { type: "STRING", description: "Plato/adicional/producto" },
              qty: { type: "INTEGER", description: "Cantidad para agregar/quitar, o el total exacto si op='fijar'" },
              op: {
                type: "STRING",
                enum: ["agregar", "quitar", "fijar"],
                description: "agregar (por defecto), quitar, o fijar la cantidad exacta",
              },
            },
            required: ["name"],
          },
        },
      },
      required: ["mesa", "cambios"],
    },
    validate: (raw) => modificarCuentaSchema.parse(raw),
    preview: async (args, ctx) => {
      const a = modificarCuentaSchema.parse(args);
      const cuenta = await resolveCuenta(ctx, a.mesa);
      if (!cuenta) throw new Error(`No encontré una cuenta abierta como «${a.mesa}».`);
      const { items, missing, reactivar } = await applyCambios(ctx, cuenta, a.cambios);
      if (missing.length)
        throw new Error(`No encontré en el menú de hoy: ${missing.join(", ")}. Dime bien el nombre o a cuál plato del menú te refieres.`);
      if (items.length === 0)
        throw new Error(`Eso dejaría «${cuenta.label}» vacía. Si no se usará, mejor elimínala.`);
      const nota = reactivar.length
        ? ` (${reactivar.map((r) => r.name).join(", ")} estaba agotado — lo reactivo)`
        : "";
      return `«${cuenta.label}» quedará: ${listLines(items)} = ${money(itemsTotal(items))}.${nota} ¿Confirmo?`;
    },
    execute: async (args, ctx) => {
      const a = modificarCuentaSchema.parse(args);
      const cuenta = await resolveCuenta(ctx, a.mesa);
      if (!cuenta) throw new Error(`No encontré una cuenta abierta como «${a.mesa}».`);
      const { items, missing, reactivar } = await applyCambios(ctx, cuenta, a.cambios);
      if (missing.length)
        throw new Error(`No encontré en el menú de hoy: ${missing.join(", ")}. Dime bien el nombre o a cuál plato del menú te refieres.`);
      if (items.length === 0)
        throw new Error(`Eso dejaría «${cuenta.label}» vacía. Si no se usará, mejor elimínala.`);
      await reactivarPlatos(ctx, reactivar.map((r) => r.id));
      const total = itemsTotal(items);
      const { error } = await ctx.db
        .from("cuentas_mesa")
        .update({
          items: items as unknown as Json,
          total,
          updated_at: new Date().toISOString(),
        })
        .eq("id", cuenta.id)
        .eq("restaurant_id", ctx.session.restaurant_id)
        .eq("status", "abierta");
      if (error) throw new Error(error.message);
      await logEvent(ctx, "venta", `Modificó la cuenta «${cuenta.label}» (ahora ${money(total)})`, {
        mesa: true,
        label: cuenta.label,
        total,
        count: items.length,
      });
      return { message: `✅ «${cuenta.label}» actualizada: ${listLines(items)} = ${money(total)}.` };
    },
  },

  cobrar_cuenta: {
    name: "cobrar_cuenta",
    mode: "write",
    description:
      "Cobra una cuenta/mesa abierta: la vuelve venta real al contado (descuenta inventario y entra a la caja). Úsalo para 'cobra la mesa 2', 'cierra la cuenta de la mesa 1'.",
    parameters: {
      type: "OBJECT",
      properties: { mesa: { type: "STRING", description: "Mesa/cuenta a cobrar (ej. 'Mesa 2')" } },
      required: ["mesa"],
    },
    validate: (raw) => cobrarCuentaSchema.parse(raw),
    preview: async (args, ctx) => {
      const a = cobrarCuentaSchema.parse(args);
      const cuenta = await resolveCuenta(ctx, a.mesa);
      if (!cuenta) throw new Error(`No encontré una cuenta abierta como «${a.mesa}».`);
      return `Cobrar «${cuenta.label}»: ${listLines(cuenta.items)} = ${money(cuenta.total)} (efectivo). ¿Confirmo?`;
    },
    execute: async (args, ctx) => {
      const a = cobrarCuentaSchema.parse(args);
      const cuenta = await resolveCuenta(ctx, a.mesa);
      if (!cuenta) throw new Error(`No encontré una cuenta abierta como «${a.mesa}».`);
      const { data, error } = await ctx.db.rpc("cobrar_cuenta_mesa", {
        p_restaurant: ctx.session.restaurant_id,
        p_session: ctx.session.shift_session_id,
        p_user: ctx.session.user_id,
        p_date: businessDate(),
        p_cuenta_id: cuenta.id,
        p_payment_method: "efectivo",
      });
      if (error) throw new Error(error.message);
      const d = data as { total?: number; count?: number; op_id?: string } | null;
      const total = Number(d?.total ?? cuenta.total);
      await logEvent(
        ctx,
        "venta",
        `Cobró la cuenta «${cuenta.label}»: ${money(total)} (${Number(d?.count ?? cuenta.items.length)} ítems)`,
        { mesa: true, label: cuenta.label, total, count: Number(d?.count ?? cuenta.items.length) },
        d?.op_id ?? null,
      );
      return { message: `✅ Cuenta «${cuenta.label}» cobrada: ${money(total)}.` };
    },
  },

  eliminar_cuenta: {
    name: "eliminar_cuenta",
    mode: "write",
    description:
      "Elimina/anula una cuenta/mesa abierta SIN cobrarla (no toca inventario ni caja). Úsalo para 'elimina la mesa 2', 'la mesa 3 ya no va, bórrala'.",
    parameters: {
      type: "OBJECT",
      properties: { mesa: { type: "STRING", description: "Mesa/cuenta a eliminar (ej. 'Mesa 2')" } },
      required: ["mesa"],
    },
    validate: (raw) => eliminarCuentaSchema.parse(raw),
    preview: async (args, ctx) => {
      const a = eliminarCuentaSchema.parse(args);
      const cuenta = await resolveCuenta(ctx, a.mesa);
      if (!cuenta) throw new Error(`No encontré una cuenta abierta como «${a.mesa}».`);
      return `Eliminar la cuenta «${cuenta.label}» (${money(cuenta.total)}) sin cobrar. ¿Confirmo?`;
    },
    execute: async (args, ctx) => {
      const a = eliminarCuentaSchema.parse(args);
      const cuenta = await resolveCuenta(ctx, a.mesa);
      if (!cuenta) throw new Error(`No encontré una cuenta abierta como «${a.mesa}».`);
      const { error } = await ctx.db
        .from("cuentas_mesa")
        .update({ status: "anulada", updated_at: new Date().toISOString() })
        .eq("id", cuenta.id)
        .eq("restaurant_id", ctx.session.restaurant_id)
        .eq("status", "abierta");
      if (error) throw new Error(error.message);
      await logEvent(ctx, "anulacion", `Eliminó la cuenta «${cuenta.label}» sin cobrar (${money(cuenta.total)})`, {
        mesa: true,
        label: cuenta.label,
        total: cuenta.total,
      });
      return { message: `🗑️ Cuenta «${cuenta.label}» eliminada (no se cobró).` };
    },
  },
};

/**
 * Separa los ítems de un consumo propio: solo el PLATO PRINCIPAL del MENÚ DE HOY
 * es gratis. Se rechazan adicionales, bebidas/productos y lo que no esté en el menú.
 */
async function splitConsumo(
  ctx: ToolCtx,
  items: ItemInput[],
): Promise<{ allowed: ResolvedLine[]; rejected: string[] }> {
  const menu = await todayMenu(ctx);
  const allowed: ResolvedLine[] = [];
  const rejected: string[] = [];
  for (const it of items) {
    const m = menu.find(
      (x) => x.dishId && !x.isExtra && x.name.toLowerCase().includes(it.name.toLowerCase()),
    );
    if (m && m.dishId) {
      allowed.push({ kind: "plato", id: m.dishId, name: m.name, unitPrice: 0, qty: it.qty });
    } else {
      rejected.push(it.name);
    }
  }
  return { allowed, rejected };
}

export function getTool(name: string): Tool | undefined {
  return TOOLS[name];
}

/** Declaraciones para Gemini (function calling). */
export const geminiFunctionDeclarations = Object.values(TOOLS).map((t) => ({
  name: t.name,
  description: t.description,
  parameters: t.parameters,
}));

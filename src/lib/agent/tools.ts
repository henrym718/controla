import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { SessionClaims } from "@/lib/auth/jwt";
import { businessDate } from "@/lib/shifts";
import { computeDaySummary } from "@/lib/reports";
import { logActivity, type EventCode } from "@/lib/activity";

export type Db = SupabaseClient<Database>;
export interface ToolCtx {
  db: Db;
  session: SessionClaims;
  /** PIN de admin ingresado al confirmar (solo para acciones sensibles). */
  pin?: string;
}
export interface ToolResult {
  message: string;
  loggedOut?: boolean;
}

interface Tool {
  name: string;
  mode: "read" | "write";
  description: string;
  /** Exige PIN de admin al confirmar (anular, eliminar). */
  requiresPin?: boolean;
  parameters: Record<string, unknown>; // schema estilo Gemini
  validate: (raw: unknown) => Record<string, unknown>;
  preview?: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<string>;
  execute: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<ToolResult>;
}

/**
 * Valida el PIN de CUALQUIER usuario activo (admin o empleada) y devuelve quién
 * es, para firmar la acción. Lo usan las reversas: las registran tanto la admin
 * como las empleadas, así que basta un PIN válido del restaurante.
 */
async function requireValidPin(
  ctx: ToolCtx,
): Promise<{ id: string; name: string; role: string }> {
  const pin = (ctx.pin ?? "").trim();
  if (!pin) throw new Error("Ingresa tu PIN para confirmar.");
  const { data } = await ctx.db.rpc("login_pin", {
    p_restaurant: ctx.session.restaurant_id,
    p_pin: pin,
  });
  const u = (data as { id: string; name: string; role: string }[] | null)?.[0];
  if (!u) throw new Error("PIN inválido.");
  return u;
}

const money = (n: number) => `$${n.toFixed(2)}`;

// ---------------------------------------------------------------------------
//  Resolvers (solo lectura)
// ---------------------------------------------------------------------------
async function resolveDish(ctx: ToolCtx, name: string) {
  const { data } = await ctx.db
    .from("dishes")
    .select("id,name,price")
    .eq("restaurant_id", ctx.session.restaurant_id)
    .ilike("name", `%${name}%`)
    .limit(1);
  return data?.[0] ?? null;
}

async function resolveIngredient(ctx: ToolCtx, name: string) {
  const { data } = await ctx.db
    .from("ingredients")
    .select("id,name,kind,costing_method,last_unit_cost,is_disposable,is_sellable,sale_price")
    .eq("restaurant_id", ctx.session.restaurant_id)
    .ilike("name", `%${name}%`)
    .limit(1);
  return data?.[0] ?? null;
}

/** Producto del inventario vendible directo (cola, agua…). */
async function resolveSellableProduct(ctx: ToolCtx, name: string) {
  const { data } = await ctx.db
    .from("ingredients")
    .select("id,name,sale_price,last_unit_cost")
    .eq("restaurant_id", ctx.session.restaurant_id)
    .eq("is_sellable", true)
    .ilike("name", `%${name}%`)
    .limit(1);
  return data?.[0] ?? null;
}

/** Descartable (lonchera, bandeja, vaso) por nombre. */
async function resolvePackaging(ctx: ToolCtx, name: string) {
  const { data } = await ctx.db
    .from("ingredients")
    .select("id,name")
    .eq("restaurant_id", ctx.session.restaurant_id)
    .eq("is_disposable", true)
    .ilike("name", `%${name}%`)
    .limit(1);
  return data?.[0] ?? null;
}

/** Platos del menú de HOY en el turno actual. */
async function todayMenu(ctx: ToolCtx) {
  const { data } = await ctx.db
    .from("daily_menu")
    .select("id,price,available,dishes(id,name)")
    .eq("restaurant_id", ctx.session.restaurant_id)
    .eq("business_date", businessDate())
    .eq("shift_id", ctx.session.shift_id)
    .order("sort_order");
  return (data ?? []).map((m) => {
    const d = m.dishes as unknown as { id: string; name: string } | null;
    return { menuId: m.id, price: Number(m.price), available: m.available, dishId: d?.id ?? null, name: d?.name ?? "" };
  });
}

type SaleTarget = {
  kind: "plato" | "producto";
  dishId: string | null;
  ingredientId: string | null;
  name: string;
  price: number | null;
  source: "producto" | "menu" | "catalogo" | "nuevo";
};

/** Decide si lo que se vende es un PRODUCTO de inventario o un PLATO (menú/catálogo). */
async function resolveSaleTarget(
  ctx: ToolCtx,
  name: string,
  unitPrice?: number,
): Promise<SaleTarget> {
  const prod = await resolveSellableProduct(ctx, name);
  if (prod) {
    const sp = Number(prod.sale_price ?? 0);
    return { kind: "producto", dishId: null, ingredientId: prod.id, name: prod.name, price: unitPrice ?? (sp > 0 ? sp : null), source: "producto" };
  }
  const menu = await todayMenu(ctx);
  const m = menu.find((x) => x.available && x.name.toLowerCase().includes(name.toLowerCase()));
  if (m && m.dishId) {
    return { kind: "plato", dishId: m.dishId, ingredientId: null, name: m.name, price: unitPrice ?? m.price, source: "menu" };
  }
  const dish = await resolveDish(ctx, name);
  if (dish) {
    return { kind: "plato", dishId: dish.id, ingredientId: null, name: dish.name, price: unitPrice ?? Number(dish.price), source: "catalogo" };
  }
  return { kind: "plato", dishId: null, ingredientId: null, name, price: unitPrice ?? null, source: "nuevo" };
}

/** Mapea el "tipo" hablado a los códigos de evento reversibles. */
const EVENT_BY_TIPO: Record<string, string[]> = {
  venta: ["venta"],
  compra: ["compra"],
  gasto: ["gasto"],
  caja: ["ingreso_caja", "egreso_caja"],
  cualquiera: ["venta", "compra", "gasto", "ingreso_caja", "egreso_caja"],
};

interface OpRow {
  op_id: string;
  event_code: string;
  description: string;
  anulada: boolean;
  created_at: string;
}

/** Resuelve la operación reciente a anular (la más nueva que no esté anulada). */
async function resolveOperacion(
  ctx: ToolCtx,
  tipo: string,
  descripcion?: string,
): Promise<{ opId: string; description: string } | null> {
  const to = businessDate();
  const d = new Date(`${to}T00:00:00`);
  d.setDate(d.getDate() - 2);
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const { data } = await ctx.db.rpc("operaciones_reversibles", {
    p_restaurant: ctx.session.restaurant_id,
    p_from: from,
    p_to: to,
  });
  const rows = (data as unknown as OpRow[] | null) ?? [];
  const codes = EVENT_BY_TIPO[tipo] ?? EVENT_BY_TIPO.cualquiera;
  const hint = (descripcion ?? "").toLowerCase().trim();
  const match = rows.find(
    (r) =>
      !r.anulada &&
      codes.includes(r.event_code) &&
      (!hint || (r.description ?? "").toLowerCase().includes(hint)),
  );
  return match ? { opId: match.op_id, description: match.description } : null;
}

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
const ventaSchema = z.object({
  item_name: z.string().min(1),
  qty: z.coerce.number().int().positive().default(1),
  service_type: z.enum(["llevar", "servir"]).default("servir"),
  payment_method: z.enum(["efectivo", "transferencia", "otro"]).default("efectivo"),
  unit_price: z.coerce.number().positive().optional(),
  packaging: z.string().optional(),
});
const gastoSchema = z.object({
  amount: z.coerce.number().positive(),
  category: z
    .enum(["comida", "operativo", "administrativo", "financiero", "otro"])
    .default("otro"),
  note: z.string().optional(),
  fuente_pago: z.enum(["caja", "jefa"]).default("caja"),
});
const cajaInSchema = z.object({
  amount: z.coerce.number().positive(),
  reason: z.string().optional(),
});
const cajaOutSchema = z.object({
  amount: z.coerce.number().positive(),
  reason: z.string().min(1),
});
const cajaInicialSchema = z.object({ amount: z.coerce.number().nonnegative() });
const cierreSchema = z.object({
  counted_cash: z.coerce.number().nonnegative(),
  closing_float: z.coerce.number().nonnegative().optional(),
});
const vacioSchema = z.object({});

const produccionSchema = z.object({
  ingredient_name: z.string().min(1),
  total_cost: z.coerce.number().nonnegative(),
  units_produced: z.coerce.number().positive().optional(),
});
const procesarSchema = z.object({
  input_name: z.string().min(1),
  input_qty: z.coerce.number().positive(),
  output_name: z.string().min(1),
  output_units: z.coerce.number().positive().optional(),
});
const consumoSchema = z.object({
  ingredient_name: z.string().min(1),
  qty: z.coerce.number().positive(),
});
const compraSchema = z.object({
  ingredient_name: z.string().min(1),
  total_cost: z.coerce.number().positive(),
  quantity: z.coerce.number().positive().optional(),
  sale_price: z.coerce.number().positive().optional(),
  fuente_pago: z.enum(["caja", "jefa"]).default("caja"),
});
const retiroInsumoSchema = z.object({
  ingredient_name: z.string().min(1),
  qty: z.coerce.number().positive(),
  reason: z.string().min(1),
});
const mermaInsumoSchema = z.object({
  ingredient_name: z.string().min(1),
  qty: z.coerce.number().positive(),
  reason: z.string().optional(),
});
const recetaSchema = z.object({
  dish_name: z.string().min(1),
  components: z
    .array(
      z.object({
        ingredient_name: z.string().min(1),
        qty: z.coerce.number().positive().default(1),
      }),
    )
    .min(1),
});
const menuSchema = z.object({
  items: z
    .array(
      z.object({
        dish_name: z.string().min(1),
        price: z.coerce.number().positive().optional(),
      }),
    )
    .min(1),
});
const agotadoSchema = z.object({ dish_name: z.string().min(1) });
const consultaInvSchema = z.object({ product_name: z.string().optional() });
const consultaVentasSchema = z.object({ dish_name: z.string().optional() });
const anularSchema = z.object({
  tipo: z.enum(["venta", "compra", "gasto", "caja", "cualquiera"]).default("cualquiera"),
  descripcion: z.string().optional(),
});

// ---------------------------------------------------------------------------
//  Herramientas
// ---------------------------------------------------------------------------
export const TOOLS: Record<string, Tool> = {
  // ============================ MENÚ DEL DÍA ===============================
  fijar_menu_dia: {
    name: "fijar_menu_dia",
    mode: "write",
    description:
      "Fija o agrega los platos del menú del turno de hoy, cada uno con su precio. El plato sale del catálogo; si no existe se crea. SIEMPRE confirma el precio.",
    parameters: {
      type: "OBJECT",
      properties: {
        items: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              dish_name: { type: "STRING" },
              price: { type: "NUMBER", description: "Precio del plato para hoy" },
            },
            required: ["dish_name"],
          },
        },
      },
      required: ["items"],
    },
    validate: (raw) => menuSchema.parse(raw),
    preview: async (args, ctx) => {
      const a = menuSchema.parse(args);
      const lines: string[] = [];
      for (const it of a.items) {
        const dish = await resolveDish(ctx, it.dish_name);
        const price = it.price ?? (dish ? Number(dish.price) : undefined);
        if (price == null) throw new Error(`¿A qué precio va "${it.dish_name}"?`);
        lines.push(`${dish?.name ?? it.dish_name} a ${money(price)}`);
      }
      return `Menú de hoy (este turno): ${lines.join(", ")}. ¿Confirmo?`;
    },
    execute: async (args, ctx) => {
      const a = menuSchema.parse(args);
      const items: { dish_id: string; price: number; sort_order: number }[] = [];
      let i = 0;
      for (const it of a.items) {
        let dish = await resolveDish(ctx, it.dish_name);
        const price = it.price ?? (dish ? Number(dish.price) : undefined);
        if (price == null) throw new Error(`¿A qué precio va "${it.dish_name}"?`);
        if (!dish) {
          const { data: created } = await ctx.db
            .from("dishes")
            .insert({ restaurant_id: ctx.session.restaurant_id, name: it.dish_name, price })
            .select("id,name,price")
            .single();
          dish = created ?? null;
        }
        if (dish) items.push({ dish_id: dish.id, price, sort_order: i++ });
      }
      const { error } = await ctx.db.rpc("fijar_menu", {
        p_restaurant: ctx.session.restaurant_id,
        p_date: businessDate(),
        p_shift: ctx.session.shift_id,
        p_user: ctx.session.user_id,
        p_items: items as unknown as Json,
      });
      if (error) throw new Error(error.message);
      await logEvent(
        ctx,
        "menu",
        `Fijó el menú de hoy (${items.length} ${items.length === 1 ? "plato" : "platos"})`,
        { count: items.length },
      );
      return { message: `✅ Menú de hoy fijado: ${items.length} platos.` };
    },
  },

  consultar_menu: {
    name: "consultar_menu",
    mode: "read",
    description: "Dice el menú de hoy del turno actual (platos y precios).",
    parameters: { type: "OBJECT", properties: {} },
    validate: (raw) => vacioSchema.parse(raw ?? {}),
    execute: async (_args, ctx) => {
      const menu = await todayMenu(ctx);
      const items = menu.filter((m) => m.available).map((m) => `${m.name} ${money(m.price)}`);
      return {
        message: items.length
          ? `📋 Menú de hoy: ${items.join(", ")}.`
          : "Todavía no hay menú fijado para este turno.",
      };
    },
  },

  marcar_agotado: {
    name: "marcar_agotado",
    mode: "write",
    description: "Marca un plato del menú de hoy como agotado (se acabó).",
    parameters: {
      type: "OBJECT",
      properties: { dish_name: { type: "STRING" } },
      required: ["dish_name"],
    },
    validate: (raw) => agotadoSchema.parse(raw),
    preview: async (args) => {
      const a = agotadoSchema.parse(args);
      return `Marcar "${a.dish_name}" como agotado hoy. ¿Confirmo?`;
    },
    execute: async (args, ctx) => {
      const a = agotadoSchema.parse(args);
      const dish = await resolveDish(ctx, a.dish_name);
      if (!dish) throw new Error(`No conozco "${a.dish_name}".`);
      await ctx.db
        .from("daily_menu")
        .update({ available: false })
        .eq("restaurant_id", ctx.session.restaurant_id)
        .eq("business_date", businessDate())
        .eq("shift_id", ctx.session.shift_id)
        .eq("dish_id", dish.id);
      await logEvent(ctx, "agotado", `Marcó "${dish.name}" como agotado hoy`, {
        dish: dish.name,
      });
      return { message: `✅ "${dish.name}" marcado como agotado hoy.` };
    },
  },

  // ============================== VENTAS ===================================
  registrar_venta: {
    name: "registrar_venta",
    mode: "write",
    description:
      "Registra una venta. Puede ser un PLATO del menú o un PRODUCTO del inventario (cola, agua). Indica cantidad, si es para llevar o servir, y el método de pago. Para 'llevar' se consume el envase; si no está claro cuál, pregúntalo.",
    parameters: {
      type: "OBJECT",
      properties: {
        item_name: { type: "STRING", description: "Nombre del plato o producto vendido" },
        qty: { type: "INTEGER", description: "Cantidad" },
        service_type: { type: "STRING", enum: ["llevar", "servir"] },
        payment_method: { type: "STRING", enum: ["efectivo", "transferencia", "otro"] },
        unit_price: { type: "NUMBER", description: "Precio unitario (si difiere o no está en el menú)" },
        packaging: { type: "STRING", description: "Envase para llevar (lonchera, bandeja, vaso)" },
      },
      required: ["item_name"],
    },
    validate: (raw) => ventaSchema.parse(raw),
    preview: async (args, ctx) => {
      const a = ventaSchema.parse(args);
      const t = await resolveSaleTarget(ctx, a.item_name, a.unit_price);
      if (t.price == null)
        throw new Error(`No conozco "${a.item_name}". Dime el precio para registrarlo.`);
      const offMenu = t.source === "catalogo" ? " (no está en el menú de hoy)" : "";
      const env = a.service_type === "llevar" ? `, envase ${a.packaging ?? "por defecto"}` : "";
      return `Registrar venta: ${a.qty} × ${t.name} (${a.service_type}, ${a.payment_method}${env}) = ${money(t.price * a.qty)} — precio ${money(t.price)}/u${offMenu}. ¿Confirmo?`;
    },
    execute: async (args, ctx) => {
      const a = ventaSchema.parse(args);
      const t = await resolveSaleTarget(ctx, a.item_name, a.unit_price);
      if (t.price == null)
        throw new Error(`No conozco "${a.item_name}". Dime el precio para registrarlo.`);

      // crear plato nuevo en catálogo si hace falta
      let dishId = t.dishId;
      if (t.kind === "plato" && !dishId) {
        const { data: created } = await ctx.db
          .from("dishes")
          .insert({ restaurant_id: ctx.session.restaurant_id, name: t.name, price: t.price })
          .select("id")
          .single();
        dishId = created?.id ?? null;
      }

      // envase concreto para llevar
      let packagingId: string | undefined;
      if (a.service_type === "llevar" && a.packaging) {
        const pk = await resolvePackaging(ctx, a.packaging);
        packagingId = pk?.id;
      }

      const { data, error } = await ctx.db.rpc("registrar_venta", {
        p_restaurant: ctx.session.restaurant_id,
        p_session: ctx.session.shift_session_id,
        p_user: ctx.session.user_id,
        p_date: businessDate(),
        p_item_kind: t.kind,
        p_dish_id: dishId,
        p_ingredient_id: t.ingredientId,
        p_name: t.name,
        p_qty: a.qty,
        p_unit_price: t.price,
        p_service_type: a.service_type,
        p_payment_method: a.payment_method,
        p_packaging_id: packagingId,
      } as unknown as Database["public"]["Functions"]["registrar_venta"]["Args"]);
      if (error) throw new Error(error.message);
      const total = Number((data as { total?: number } | null)?.total ?? t.price * a.qty);
      const opId = (data as { op_id?: string } | null)?.op_id ?? null;
      await logEvent(
        ctx,
        "venta",
        `Venta de ${a.qty} × ${t.name} por ${money(total)} (${a.service_type}, ${a.payment_method})`,
        { item: t.name, qty: a.qty, total, payment_method: a.payment_method },
        opId,
      );
      return { message: `✅ Venta: ${a.qty} × ${t.name} = ${money(total)}.` };
    },
  },

  // ====================== COMPRA / INVENTARIO ==============================
  registrar_compra: {
    name: "registrar_compra",
    mode: "write",
    description:
      "Registra una compra de un producto/insumo que ENTRA al inventario (arroz, aceite, colas). Indica la cantidad. Si el producto YA existe en el inventario, NO vuelvas a preguntar el precio de venta (ya está guardado) y el costo se promedia solo con lo que había; solo pregunta el precio de venta la primera vez para un producto vendible nuevo. Pregunta si el dinero salió de la caja o lo puso la jefa.",
    parameters: {
      type: "OBJECT",
      properties: {
        ingredient_name: { type: "STRING", description: "Producto/insumo comprado" },
        total_cost: { type: "NUMBER", description: "Cuánto se pagó en total" },
        quantity: { type: "NUMBER", description: "Unidades compradas (sube al inventario)" },
        sale_price: { type: "NUMBER", description: "Precio de venta si es un producto vendible" },
        fuente_pago: { type: "STRING", enum: ["caja", "jefa"], description: "De dónde salió el dinero" },
      },
      required: ["ingredient_name", "total_cost"],
    },
    validate: (raw) => compraSchema.parse(raw),
    preview: async (args) => {
      const a = compraSchema.parse(args);
      const qty = a.quantity ? ` (${a.quantity} u)` : "";
      const sp = a.sale_price ? `, se vende a ${money(a.sale_price)}` : "";
      const fuente = a.fuente_pago === "jefa" ? "la jefa (aporte a caja)" : "la caja";
      return `Registrar compra: ${a.ingredient_name} por ${money(a.total_cost)}${qty}${sp} — paga ${fuente}. ¿Confirmo?`;
    },
    execute: async (args, ctx) => {
      const a = compraSchema.parse(args);
      let ing = await resolveIngredient(ctx, a.ingredient_name);
      if (!ing) {
        const contable = a.quantity != null || a.sale_price != null;
        const { data: created } = await ctx.db
          .from("ingredients")
          .insert({
            restaurant_id: ctx.session.restaurant_id,
            name: a.ingredient_name,
            kind: contable ? "contable" : "granel",
            costing_method: contable ? "conversion" : "pool",
            consumption_unit: contable ? "unidad" : null,
          })
          .select("id,name,kind,costing_method,last_unit_cost,is_disposable,is_sellable,sale_price")
          .single();
        ing = created ?? null;
      }
      if (!ing) throw new Error("No pude registrar el producto.");

      const { data: compraData, error } = await ctx.db.rpc("registrar_compra", {
        p_restaurant: ctx.session.restaurant_id,
        p_session: ctx.session.shift_session_id,
        p_user: ctx.session.user_id,
        p_date: businessDate(),
        p_ingredient_id: ing.id,
        p_name: ing.name,
        p_total_cost: a.total_cost,
        p_quantity: a.quantity,
        p_sale_price: a.sale_price,
        p_fuente: a.fuente_pago,
      });
      if (error) throw new Error(error.message);
      const sp = a.sale_price ? ` (se vende a ${money(a.sale_price)})` : "";
      const qtyTxt = a.quantity ? ` (${a.quantity} u)` : "";
      await logEvent(
        ctx,
        "compra",
        `Compra de ${ing.name} por ${money(a.total_cost)}${qtyTxt} — pagó ${a.fuente_pago === "jefa" ? "la jefa" : "la caja"}`,
        { ingredient: ing.name, total_cost: a.total_cost, quantity: a.quantity ?? null, fuente: a.fuente_pago },
        (compraData as { op_id?: string } | null)?.op_id ?? null,
      );
      return { message: `✅ Compra: ${ing.name} ${money(a.total_cost)}${sp}.` };
    },
  },

  registrar_produccion: {
    name: "registrar_produccion",
    mode: "write",
    description:
      "Registra una tanda de producción. Si dice cuántas unidades salieron (presas, bolsitas) es contable; si no, es a granel (arroz, sopa) y entra al pool del día.",
    parameters: {
      type: "OBJECT",
      properties: {
        ingredient_name: { type: "STRING", description: "Insumo producido" },
        total_cost: { type: "NUMBER", description: "Cuánto costó la tanda" },
        units_produced: { type: "NUMBER", description: "Unidades que salieron (solo si es contable)" },
      },
      required: ["ingredient_name", "total_cost"],
    },
    validate: (raw) => produccionSchema.parse(raw),
    preview: async (args) => {
      const a = produccionSchema.parse(args);
      return a.units_produced
        ? `Producción: ${a.units_produced} × ${a.ingredient_name} por ${money(a.total_cost)} (${money(a.total_cost / a.units_produced)} c/u). ¿Confirmo?`
        : `Producción a granel: ${a.ingredient_name} por ${money(a.total_cost)} al pool del día. ¿Confirmo?`;
    },
    execute: async (args, ctx) => {
      const a = produccionSchema.parse(args);
      let ing = await resolveIngredient(ctx, a.ingredient_name);
      const kind = ing?.kind ?? (a.units_produced != null ? "contable" : "granel");
      if (kind === "contable" && a.units_produced == null)
        throw new Error(`¿Cuántas unidades salieron de ${a.ingredient_name}?`);

      if (!ing) {
        const { data: created } = await ctx.db
          .from("ingredients")
          .insert({
            restaurant_id: ctx.session.restaurant_id,
            name: a.ingredient_name,
            kind: kind === "contable" ? "contable" : "granel",
            costing_method: kind === "contable" ? "tanda" : "pool",
            consumption_unit: kind === "contable" ? "unidad" : null,
          })
          .select("id,name,kind,costing_method,last_unit_cost,is_disposable,is_sellable,sale_price")
          .single();
        ing = created ?? null;
      }
      if (!ing) throw new Error("No pude registrar el insumo.");

      const { data: batch } = await ctx.db
        .from("production_batches")
        .insert({
          restaurant_id: ctx.session.restaurant_id,
          ingredient_id: ing.id,
          shift_session_id: ctx.session.shift_session_id,
          business_date: businessDate(),
          user_id: ctx.session.user_id,
          total_cost: a.total_cost,
          units_produced: a.units_produced ?? null,
        })
        .select("id")
        .single();

      if (a.units_produced != null) {
        const unit = a.total_cost / a.units_produced;
        await ctx.db.from("ingredients").update({ last_unit_cost: unit }).eq("id", ing.id);
        await ctx.db.from("inventory_movements").insert({
          restaurant_id: ctx.session.restaurant_id,
          ingredient_id: ing.id,
          shift_session_id: ctx.session.shift_session_id,
          business_date: businessDate(),
          type: "produccion",
          qty: a.units_produced,
          unit_cost: unit,
          ref_table: "production_batches",
          ref_id: batch?.id ?? null,
        });
        await logEvent(
          ctx,
          "produccion",
          `Producción de ${a.units_produced} × ${ing.name} por ${money(a.total_cost)} (${money(unit)} c/u)`,
          { ingredient: ing.name, units: a.units_produced, total_cost: a.total_cost },
        );
        return { message: `✅ Producción: ${a.units_produced} × ${ing.name} (${money(unit)} c/u).` };
      }
      await logEvent(
        ctx,
        "produccion",
        `Producción a granel de ${ing.name} por ${money(a.total_cost)} (al pool del día)`,
        { ingredient: ing.name, total_cost: a.total_cost, granel: true },
      );
      return { message: `✅ ${ing.name} a granel: +${money(a.total_cost)} al pool del día.` };
    },
  },

  procesar_insumo: {
    name: "procesar_insumo",
    mode: "write",
    description:
      "Convierte un insumo CRUDO en otro consumiendo su stock: ej. 'de 2 pollos salieron 28 presas', 'de 20 dedos de verde salieron 20 tortillas'. Si dicen cuántas unidades salieron, la salida es contable (costo exacto por unidad); si no, va a granel (pool del día). HEREDA el costo del crudo — NO preguntes el costo.",
    parameters: {
      type: "OBJECT",
      properties: {
        input_name: { type: "STRING", description: "Insumo crudo usado (pollo, libra de carne, dedo de verde)" },
        input_qty: { type: "NUMBER", description: "Cuánto del crudo se usó" },
        output_name: { type: "STRING", description: "Qué salió (presa, tajada, tortilla)" },
        output_units: { type: "NUMBER", description: "Cuántas unidades salieron (omitir si es a granel)" },
      },
      required: ["input_name", "input_qty", "output_name"],
    },
    validate: (raw) => procesarSchema.parse(raw),
    preview: async (args, ctx) => {
      const a = procesarSchema.parse(args);
      const inp = await resolveIngredient(ctx, a.input_name);
      if (!inp) throw new Error(`No conozco "${a.input_name}". Regístralo como compra primero.`);
      const cost = a.input_qty * Number(inp.last_unit_cost ?? 0);
      return a.output_units
        ? `Procesar: ${a.input_qty} × ${inp.name} → ${a.output_units} × ${a.output_name} (costo ${money(cost)}, ${money(cost / a.output_units)} c/u). ¿Confirmo?`
        : `Procesar a granel: ${a.input_qty} × ${inp.name} → ${a.output_name} (${money(cost)} al pool). ¿Confirmo?`;
    },
    execute: async (args, ctx) => {
      const a = procesarSchema.parse(args);
      const inp = await resolveIngredient(ctx, a.input_name);
      if (!inp) throw new Error(`No conozco "${a.input_name}".`);
      if (inp.kind !== "contable")
        throw new Error(`${inp.name} es a granel; no se procesa por unidades.`);

      const contable = a.output_units != null;
      let out = await resolveIngredient(ctx, a.output_name);
      if (!out) {
        const { data: created } = await ctx.db
          .from("ingredients")
          .insert({
            restaurant_id: ctx.session.restaurant_id,
            name: a.output_name,
            kind: contable ? "contable" : "granel",
            costing_method: contable ? "tanda" : "pool",
            consumption_unit: contable ? "unidad" : null,
          })
          .select("id,name,kind,costing_method,last_unit_cost,is_disposable,is_sellable,sale_price")
          .single();
        out = created ?? null;
      }
      if (!out) throw new Error("No pude registrar la salida.");

      const { data, error } = await ctx.db.rpc("procesar_insumo", {
        p_restaurant: ctx.session.restaurant_id,
        p_session: ctx.session.shift_session_id,
        p_user: ctx.session.user_id,
        p_date: businessDate(),
        p_input_id: inp.id,
        p_input_qty: a.input_qty,
        p_output_id: out.id,
        p_output_units: a.output_units,
      });
      if (error) throw new Error(error.message);
      const d = data as { cost?: number; unit_cost?: number } | null;
      await logEvent(
        ctx,
        "procesar",
        a.output_units
          ? `Procesó ${a.input_qty} × ${inp.name} → ${a.output_units} × ${out.name}`
          : `Procesó ${a.input_qty} × ${inp.name} → ${out.name} (a granel)`,
        { input: inp.name, input_qty: a.input_qty, output: out.name, output_units: a.output_units ?? null },
      );
      return a.output_units
        ? { message: `✅ Procesado: ${a.output_units} × ${out.name} (${money(Number(d?.unit_cost ?? 0))} c/u).` }
        : { message: `✅ ${out.name} a granel: +${money(Number(d?.cost ?? 0))} al pool.` };
    },
  },

  consumir_insumo: {
    name: "consumir_insumo",
    mode: "write",
    description:
      "Registra un insumo CONTABLE que se usó HOY para cocinar, sin venderlo y sin nombrar un resultado: ej. 'consumimos 4 tomates', 'usamos 10 huevos para la comida de hoy'. Baja el stock y suma su costo al pool/costo del día. HEREDA el costo del inventario — NO preguntes el costo.",
    parameters: {
      type: "OBJECT",
      properties: {
        ingredient_name: { type: "STRING", description: "Insumo que se consumió" },
        qty: { type: "NUMBER", description: "Cuánto se consumió hoy" },
      },
      required: ["ingredient_name", "qty"],
    },
    validate: (raw) => consumoSchema.parse(raw),
    preview: async (args, ctx) => {
      const a = consumoSchema.parse(args);
      const ing = await resolveIngredient(ctx, a.ingredient_name);
      if (!ing) throw new Error(`No conozco "${a.ingredient_name}".`);
      const cost = a.qty * Number(ing.last_unit_cost ?? 0);
      return `Consumo de hoy: ${a.qty} × ${ing.name} (${money(cost)} al costo del día). ¿Confirmo?`;
    },
    execute: async (args, ctx) => {
      const a = consumoSchema.parse(args);
      const ing = await resolveIngredient(ctx, a.ingredient_name);
      if (!ing) throw new Error(`No conozco "${a.ingredient_name}".`);
      if (ing.kind !== "contable")
        throw new Error(`${ing.name} es a granel; regístralo como producción/cocción.`);
      const { data, error } = await ctx.db.rpc("consumir_insumo", {
        p_restaurant: ctx.session.restaurant_id,
        p_session: ctx.session.shift_session_id,
        p_user: ctx.session.user_id,
        p_date: businessDate(),
        p_ingredient_id: ing.id,
        p_qty: a.qty,
      });
      if (error) throw new Error(error.message);
      const d = data as { cost?: number } | null;
      await logEvent(
        ctx,
        "consumo",
        `Consumo del día: ${a.qty} × ${ing.name} (${money(Number(d?.cost ?? 0))})`,
        { ingredient: ing.name, qty: a.qty, cost: Number(d?.cost ?? 0) },
      );
      return { message: `✅ Consumo del día: ${a.qty} × ${ing.name} (${money(Number(d?.cost ?? 0))}).` };
    },
  },

  retirar_insumo: {
    name: "retirar_insumo",
    mode: "write",
    description:
      "Saca un insumo/producto contable del inventario. El motivo es obligatorio (auditoría).",
    parameters: {
      type: "OBJECT",
      properties: {
        ingredient_name: { type: "STRING" },
        qty: { type: "NUMBER", description: "Unidades que se sacan" },
        reason: { type: "STRING", description: "Motivo (obligatorio)" },
      },
      required: ["ingredient_name", "qty", "reason"],
    },
    validate: (raw) => retiroInsumoSchema.parse(raw),
    preview: async (args) => {
      const a = retiroInsumoSchema.parse(args);
      return `Retirar inventario: ${a.qty} × ${a.ingredient_name} — ${a.reason}. ¿Confirmo?`;
    },
    execute: async (args, ctx) => {
      const a = retiroInsumoSchema.parse(args);
      const ing = await resolveIngredient(ctx, a.ingredient_name);
      if (!ing) throw new Error(`No conozco el insumo "${a.ingredient_name}".`);
      if (ing.kind !== "contable")
        throw new Error(`${ing.name} es a granel y no se controla por unidades.`);
      await ctx.db.from("inventory_movements").insert({
        restaurant_id: ctx.session.restaurant_id,
        ingredient_id: ing.id,
        shift_session_id: ctx.session.shift_session_id,
        business_date: businessDate(),
        type: "retiro",
        qty: -a.qty,
        unit_cost: Number(ing.last_unit_cost ?? 0),
        reason: a.reason,
      });
      await logEvent(
        ctx,
        "retiro_insumo",
        `Retiró ${a.qty} × ${ing.name} del inventario — ${a.reason}`,
        { ingredient: ing.name, qty: a.qty, reason: a.reason },
      );
      return { message: `✅ Retiro: ${a.qty} × ${ing.name} — ${a.reason}.` };
    },
  },

  registrar_merma_insumo: {
    name: "registrar_merma_insumo",
    mode: "write",
    description: "Registra merma (desperdicio) de un insumo/producto contable.",
    parameters: {
      type: "OBJECT",
      properties: {
        ingredient_name: { type: "STRING" },
        qty: { type: "NUMBER", description: "Unidades que se botaron" },
        reason: { type: "STRING" },
      },
      required: ["ingredient_name", "qty"],
    },
    validate: (raw) => mermaInsumoSchema.parse(raw),
    preview: async (args) => {
      const a = mermaInsumoSchema.parse(args);
      return `Registrar merma: ${a.qty} × ${a.ingredient_name}${a.reason ? ` — ${a.reason}` : ""}. ¿Confirmo?`;
    },
    execute: async (args, ctx) => {
      const a = mermaInsumoSchema.parse(args);
      const ing = await resolveIngredient(ctx, a.ingredient_name);
      if (!ing) throw new Error(`No conozco el insumo "${a.ingredient_name}".`);
      await ctx.db.from("inventory_movements").insert({
        restaurant_id: ctx.session.restaurant_id,
        ingredient_id: ing.id,
        shift_session_id: ctx.session.shift_session_id,
        business_date: businessDate(),
        type: "merma",
        qty: -a.qty,
        unit_cost: Number(ing.last_unit_cost ?? 0),
        reason: a.reason ?? null,
      });
      await logEvent(
        ctx,
        "merma",
        `Merma de ${a.qty} × ${ing.name}${a.reason ? ` — ${a.reason}` : ""}`,
        { ingredient: ing.name, qty: a.qty, reason: a.reason ?? null },
      );
      return { message: `✅ Merma: ${a.qty} × ${ing.name}.` };
    },
  },

  definir_receta: {
    name: "definir_receta",
    mode: "write",
    description:
      "Define o actualiza qué insumos lleva un plato (su receta). Los insumos deben existir.",
    parameters: {
      type: "OBJECT",
      properties: {
        dish_name: { type: "STRING" },
        components: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              ingredient_name: { type: "STRING" },
              qty: { type: "NUMBER" },
            },
            required: ["ingredient_name"],
          },
        },
      },
      required: ["dish_name", "components"],
    },
    validate: (raw) => recetaSchema.parse(raw),
    preview: async (args) => {
      const a = recetaSchema.parse(args);
      const list = a.components.map((c) => `${c.qty} ${c.ingredient_name}`).join(", ");
      return `Receta de ${a.dish_name}: ${list}. ¿Confirmo?`;
    },
    execute: async (args, ctx) => {
      const a = recetaSchema.parse(args);
      const dish = await resolveDish(ctx, a.dish_name);
      if (!dish) throw new Error(`No conozco el plato "${a.dish_name}".`);
      for (const c of a.components) {
        const ing = await resolveIngredient(ctx, c.ingredient_name);
        if (!ing)
          throw new Error(`No conozco el insumo "${c.ingredient_name}". Regístralo primero.`);
        await ctx.db.from("dish_components").upsert(
          {
            restaurant_id: ctx.session.restaurant_id,
            dish_id: dish.id,
            ingredient_id: ing.id,
            qty: c.qty,
          },
          { onConflict: "dish_id,ingredient_id" },
        );
      }
      await logEvent(
        ctx,
        "receta",
        `Actualizó la receta de ${dish.name} (${a.components.length} insumos)`,
        { dish: dish.name, components: a.components.length },
      );
      return { message: `✅ Receta de ${dish.name} actualizada (${a.components.length} insumos).` };
    },
  },

  // ============================== GASTOS ===================================
  registrar_gasto: {
    name: "registrar_gasto",
    mode: "write",
    description:
      "Registra un GASTO que NO es inventario (servilletas, escoba, gas, servicios). Es un costo del día. Pregunta si el dinero salió de la caja o lo puso la jefa.",
    parameters: {
      type: "OBJECT",
      properties: {
        amount: { type: "NUMBER", description: "Monto del gasto" },
        category: { type: "STRING", enum: ["comida", "operativo", "administrativo", "financiero", "otro"] },
        note: { type: "STRING", description: "Para qué fue el gasto" },
        fuente_pago: { type: "STRING", enum: ["caja", "jefa"], description: "De dónde salió el dinero" },
      },
      required: ["amount"],
    },
    validate: (raw) => gastoSchema.parse(raw),
    preview: async (args) => {
      const a = gastoSchema.parse(args);
      const fuente = a.fuente_pago === "jefa" ? "lo puso la jefa (aporte a caja)" : "de la caja";
      return `Registrar gasto: ${money(a.amount)} (${a.category})${a.note ? ` — ${a.note}` : ""} — ${fuente}. ¿Confirmo?`;
    },
    execute: async (args, ctx) => {
      const a = gastoSchema.parse(args);
      const { data: gastoData, error } = await ctx.db.rpc("registrar_gasto", {
        p_restaurant: ctx.session.restaurant_id,
        p_session: ctx.session.shift_session_id,
        p_user: ctx.session.user_id,
        p_date: businessDate(),
        p_amount: a.amount,
        p_category: a.category,
        p_note: a.note ?? "",
        p_fuente: a.fuente_pago,
      });
      if (error) throw new Error(error.message);
      await logEvent(
        ctx,
        "gasto",
        `Gasto de ${money(a.amount)} (${a.category})${a.note ? ` — ${a.note}` : ""} — pagó ${a.fuente_pago === "jefa" ? "la jefa" : "la caja"}`,
        { amount: a.amount, category: a.category, note: a.note ?? null, fuente: a.fuente_pago },
        (gastoData as { op_id?: string } | null)?.op_id ?? null,
      );
      return { message: `✅ Gasto registrado: ${money(a.amount)} (${a.category}).` };
    },
  },

  // =============================== CAJA ====================================
  ingresar_caja: {
    name: "ingresar_caja",
    mode: "write",
    description: "Ingresa dinero a la caja del turno (aporte, no es una venta).",
    parameters: {
      type: "OBJECT",
      properties: { amount: { type: "NUMBER" }, reason: { type: "STRING" } },
      required: ["amount"],
    },
    validate: (raw) => cajaInSchema.parse(raw),
    preview: async (args) => {
      const a = cajaInSchema.parse(args);
      return `Ingresar a caja: ${money(a.amount)}${a.reason ? ` — ${a.reason}` : ""}. ¿Confirmo?`;
    },
    execute: async (args, ctx) => {
      const a = cajaInSchema.parse(args);
      const opId = crypto.randomUUID();
      await ctx.db
        .from("cash_movements")
        .insert({
          restaurant_id: ctx.session.restaurant_id,
          shift_session_id: ctx.session.shift_session_id,
          user_id: ctx.session.user_id,
          type: "ingreso",
          amount: a.amount,
          reason: a.reason ?? null,
          op_id: opId,
        });
      await logEvent(
        ctx,
        "ingreso_caja",
        `Ingreso a caja de ${money(a.amount)}${a.reason ? ` — ${a.reason}` : ""}`,
        { amount: a.amount, reason: a.reason ?? null },
        opId,
      );
      return { message: `✅ Ingreso a caja: ${money(a.amount)}.` };
    },
  },

  retirar_caja: {
    name: "retirar_caja",
    mode: "write",
    description: "Retira dinero de la caja del turno. El motivo es obligatorio (auditoría).",
    parameters: {
      type: "OBJECT",
      properties: {
        amount: { type: "NUMBER" },
        reason: { type: "STRING", description: "Motivo del retiro (obligatorio)" },
      },
      required: ["amount", "reason"],
    },
    validate: (raw) => cajaOutSchema.parse(raw),
    preview: async (args) => {
      const a = cajaOutSchema.parse(args);
      return `Retirar de caja: ${money(a.amount)} — ${a.reason}. ¿Confirmo?`;
    },
    execute: async (args, ctx) => {
      const a = cajaOutSchema.parse(args);
      const opId = crypto.randomUUID();
      await ctx.db
        .from("cash_movements")
        .insert({
          restaurant_id: ctx.session.restaurant_id,
          shift_session_id: ctx.session.shift_session_id,
          user_id: ctx.session.user_id,
          type: "egreso",
          amount: a.amount,
          reason: a.reason,
          op_id: opId,
        });
      await logEvent(
        ctx,
        "egreso_caja",
        `Retiro de caja de ${money(a.amount)} — ${a.reason}`,
        { amount: a.amount, reason: a.reason },
        opId,
      );
      return { message: `✅ Retiro de caja: ${money(a.amount)} — ${a.reason}.` };
    },
  },

  fijar_caja_inicial: {
    name: "fijar_caja_inicial",
    mode: "write",
    description: "Fija con cuánto dinero inicia la caja del turno.",
    parameters: {
      type: "OBJECT",
      properties: { amount: { type: "NUMBER" } },
      required: ["amount"],
    },
    validate: (raw) => cajaInicialSchema.parse(raw),
    preview: async (args) => {
      const a = cajaInicialSchema.parse(args);
      return `Fijar caja inicial del turno en ${money(a.amount)}. ¿Confirmo?`;
    },
    execute: async (args, ctx) => {
      const a = cajaInicialSchema.parse(args);
      await ctx.db
        .from("shift_sessions")
        .update({ opening_cash: a.amount })
        .eq("id", ctx.session.shift_session_id)
        .eq("restaurant_id", ctx.session.restaurant_id);
      await logEvent(ctx, "caja_inicial", `Fijó la caja inicial del turno en ${money(a.amount)}`, {
        amount: a.amount,
      });
      return { message: `✅ Caja inicial: ${money(a.amount)}.` };
    },
  },

  consultar_caja: {
    name: "consultar_caja",
    mode: "read",
    description: "Dice cuánto dinero debería haber en la caja del turno ahora.",
    parameters: { type: "OBJECT", properties: {} },
    validate: (raw) => vacioSchema.parse(raw ?? {}),
    execute: async (_args, ctx) => {
      const { data } = await ctx.db
        .from("v_caja_turno")
        .select("caja_esperada,opening_cash")
        .eq("shift_session_id", ctx.session.shift_session_id)
        .maybeSingle();
      return {
        message: `💵 Caja esperada ahora: ${money(Number(data?.caja_esperada ?? 0))} (inicial ${money(Number(data?.opening_cash ?? 0))}).`,
      };
    },
  },

  // ============================ CONSULTAS ==================================
  consultar_inventario: {
    name: "consultar_inventario",
    mode: "read",
    description:
      "Dice el stock de un producto/insumo contable (y su costo/precio). Sin nombre, lista los de menor stock.",
    parameters: {
      type: "OBJECT",
      properties: { product_name: { type: "STRING", description: "Producto a consultar (opcional)" } },
    },
    validate: (raw) => consultaInvSchema.parse(raw ?? {}),
    execute: async (args, ctx) => {
      const a = consultaInvSchema.parse(args ?? {});
      if (a.product_name) {
        const ing = await resolveIngredient(ctx, a.product_name);
        if (!ing) return { message: `No conozco "${a.product_name}".` };
        const { data } = await ctx.db
          .from("v_stock_contable")
          .select("stock")
          .eq("ingredient_id", ing.id)
          .maybeSingle();
        const stock = Number(data?.stock ?? 0);
        const extra = ing.is_sellable ? `, se vende a ${money(Number(ing.sale_price ?? 0))}` : "";
        return {
          message: `📦 ${ing.name}: ${stock} en stock (costo ${money(Number(ing.last_unit_cost ?? 0))}${extra}).`,
        };
      }
      const { data } = await ctx.db
        .from("v_stock_contable")
        .select("name,stock")
        .eq("restaurant_id", ctx.session.restaurant_id)
        .order("stock")
        .limit(8);
      const list = (data ?? []).map((r) => `${r.name}: ${Number(r.stock)}`).join(", ");
      return { message: `📦 Inventario: ${list || "vacío"}.` };
    },
  },

  consultar_ventas: {
    name: "consultar_ventas",
    mode: "read",
    description:
      "Resume las ventas del turno actual. Si das un plato, dice cuánto se ha vendido de ese plato.",
    parameters: {
      type: "OBJECT",
      properties: { dish_name: { type: "STRING", description: "Plato a consultar (opcional)" } },
    },
    validate: (raw) => consultaVentasSchema.parse(raw ?? {}),
    execute: async (args, ctx) => {
      const a = consultaVentasSchema.parse(args ?? {});
      const { data } = await ctx.db
        .from("sales")
        .select("qty,total,dish_name")
        .eq("shift_session_id", ctx.session.shift_session_id)
        .is("voided_at", null);
      let rows = data ?? [];
      if (a.dish_name) {
        const n = a.dish_name.toLowerCase();
        rows = rows.filter((r) => (r.dish_name ?? "").toLowerCase().includes(n));
        const qty = rows.reduce((s, r) => s + Number(r.qty), 0);
        const total = rows.reduce((s, r) => s + Number(r.total), 0);
        return { message: `📊 ${a.dish_name}: ${qty} vendidos, ${money(total)} en el turno.` };
      }
      const total = rows.reduce((s, r) => s + Number(r.total), 0);
      return { message: `📊 Turno: ${rows.length} ventas, total ${money(total)}.` };
    },
  },

  consultar_resumen_dia: {
    name: "consultar_resumen_dia",
    mode: "read",
    description:
      "Resumen financiero del día: ventas, costos, gastos, utilidad aproximada y caja esperada. Útil para '¿cuánto hemos ganado/vendido hoy?'.",
    parameters: { type: "OBJECT", properties: {} },
    validate: (raw) => vacioSchema.parse(raw ?? {}),
    execute: async (_args, ctx) => {
      const s = await computeDaySummary(ctx.db, ctx.session.restaurant_id, businessDate());
      const { data: caja } = await ctx.db
        .from("v_caja_turno")
        .select("caja_esperada")
        .eq("shift_session_id", ctx.session.shift_session_id)
        .maybeSingle();
      const costos = s.insumos.total + s.productos.total + s.gastos.total + s.fijos.total;
      return {
        message: `📅 Hoy: ventas ${money(s.ventas)}, costos ${money(costos)}, utilidad ${money(s.utilidad)}. Caja esperada ${money(Number(caja?.caja_esperada ?? 0))}.`,
      };
    },
  },

  // ============================== CIERRES ==================================
  cerrar_turno: {
    name: "cerrar_turno",
    mode: "write",
    description:
      "Cierra el turno: cuadra la caja (esperado vs contado). Pide cuánto dinero se contó físicamente. Opcional: cuánto se deja de base para el próximo turno (por defecto, la caja inicial).",
    parameters: {
      type: "OBJECT",
      properties: {
        counted_cash: { type: "NUMBER", description: "Dinero contado en la caja" },
        closing_float: {
          type: "NUMBER",
          description: "Dinero que se deja de base para el próximo turno (por defecto, la caja inicial)",
        },
      },
      required: ["counted_cash"],
    },
    validate: (raw) => cierreSchema.parse(raw),
    preview: async (args, ctx) => {
      const a = cierreSchema.parse(args);
      const { data } = await ctx.db
        .from("v_caja_turno")
        .select("caja_esperada,opening_cash")
        .eq("shift_session_id", ctx.session.shift_session_id)
        .maybeSingle();
      const esperada = Number(data?.caja_esperada ?? 0);
      const base = a.closing_float ?? Number(data?.opening_cash ?? 0);
      const entrega = a.counted_cash - base;
      return `Cerrar turno. Caja esperada ${money(esperada)}, contaste ${money(a.counted_cash)} → descuadre ${money(a.counted_cash - esperada)}. Dejas ${money(base)} de base y entregas ${money(entrega)}. ¿Confirmo? (te sacará de la sesión)`;
    },
    execute: async (args, ctx) => {
      const a = cierreSchema.parse(args);
      const { data: caja } = await ctx.db
        .from("v_caja_turno")
        .select("opening_cash")
        .eq("shift_session_id", ctx.session.shift_session_id)
        .maybeSingle();
      const base = a.closing_float ?? Number(caja?.opening_cash ?? 0);
      const { data, error } = await ctx.db.rpc("cerrar_turno", {
        p_session_id: ctx.session.shift_session_id,
        p_counted_cash: a.counted_cash,
        p_closing_float: base,
        p_closed_by: ctx.session.user_id,
      });
      if (error) throw new Error(error.message);
      const esperada = Number(data?.expected_cash ?? 0);
      const dif = Number(data?.cash_discrepancy ?? 0);
      const entrega = Number(data?.deposit_amount ?? 0);
      await logEvent(
        ctx,
        "cerrar_turno",
        `Cerró el turno. Esperado ${money(esperada)}, contado ${money(a.counted_cash)}, descuadre ${money(dif)}`,
        { expected: esperada, counted: a.counted_cash, discrepancy: dif, deposit: entrega },
      );
      return {
        message: `🔒 Turno cerrado. Esperado ${money(esperada)}, contado ${money(a.counted_cash)}, descuadre ${money(dif)}. Base que queda ${money(base)}, entregado ${money(entrega)}.`,
        loggedOut: true,
      };
    },
  },

  cerrar_dia: {
    name: "cerrar_dia",
    mode: "write",
    description:
      "Cierra el día: calcula el prorrateo del granel (pool) y marca el día cerrado. La merma se ajusta en la pantalla de cierre.",
    parameters: { type: "OBJECT", properties: {} },
    validate: (raw) => vacioSchema.parse(raw ?? {}),
    preview: async () =>
      "Cerrar el día (calcula el costo por plato del pool del granel). ¿Confirmo?",
    execute: async (_args, ctx) => {
      const { error } = await ctx.db.rpc("cerrar_dia", {
        p_restaurant: ctx.session.restaurant_id,
        p_date: businessDate(),
        p_merma: {} as Json,
        p_closed_by: ctx.session.user_id,
      });
      if (error) throw new Error(error.message);
      await logEvent(ctx, "cerrar_dia", "Cerró el día (prorrateo del pool del granel)");
      return { message: "🔒 Día cerrado. Costos del pool calculados." };
    },
  },

  // ============================== REVERSA ==================================
  anular_operacion: {
    name: "anular_operacion",
    mode: "write",
    requiresPin: true,
    description:
      "Anula (reversa) una transacción registrada por error o devuelta: una VENTA, una COMPRA, un GASTO o un movimiento de CAJA. Úsalo cuando digan 'anula/reversa/borra la última venta', 'devolvieron las 2 colas', 'anula la compra de arroz'. Restaura el stock y la caja. EXIGE un PIN (de la admin o de la empleada) al confirmar; lo puede hacer cualquiera del turno.",
    parameters: {
      type: "OBJECT",
      properties: {
        tipo: {
          type: "STRING",
          enum: ["venta", "compra", "gasto", "caja", "cualquiera"],
          description: "Qué tipo de operación se anula",
        },
        descripcion: {
          type: "STRING",
          description: "Pista de qué operación (ej. '2 colas', 'arroz', '$5'). Vacío = la última de ese tipo.",
        },
      },
      required: ["tipo"],
    },
    validate: (raw) => anularSchema.parse(raw),
    preview: async (args, ctx) => {
      const a = anularSchema.parse(args);
      const op = await resolveOperacion(ctx, a.tipo, a.descripcion);
      if (!op) throw new Error(`No encontré una ${a.tipo === "cualquiera" ? "operación" : a.tipo} reciente para anular.`);
      return `Anular: ${op.description}. Esto revierte la plata y el stock. Necesita PIN de administradora. ¿Confirmo?`;
    },
    execute: async (args, ctx) => {
      const a = anularSchema.parse(args);
      const actor = await requireValidPin(ctx);
      const op = await resolveOperacion(ctx, a.tipo, a.descripcion);
      if (!op) throw new Error(`No encontré una ${a.tipo === "cualquiera" ? "operación" : a.tipo} reciente para anular.`);
      const { error } = await ctx.db.rpc("anular_operacion", {
        p_restaurant: ctx.session.restaurant_id,
        p_op_id: op.opId,
        p_reason: a.descripcion ? `IA: ${a.descripcion}` : "Anulación por voz",
        p_by: actor.id,
      });
      if (error) throw new Error(error.message);
      // Firmado por quien puso el PIN (admin o empleada), no por la sesión.
      await logActivity(ctx.db, {
        restaurantId: ctx.session.restaurant_id,
        userId: actor.id,
        actorName: actor.name,
        shiftSessionId: ctx.session.shift_session_id,
        source: "ia",
        event: "anulacion",
        description: `Anuló: ${op.description}`,
        metadata: { op_id: op.opId, role: actor.role },
        opId: op.opId,
      });
      return { message: `↩️ Anulado: ${op.description}.` };
    },
  },
};

export function getTool(name: string): Tool | undefined {
  return TOOLS[name];
}

/** Declaraciones para Gemini (function calling). */
export const geminiFunctionDeclarations = Object.values(TOOLS).map((t) => ({
  name: t.name,
  description: t.description,
  parameters: t.parameters,
}));

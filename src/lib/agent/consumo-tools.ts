import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { SessionClaims } from "@/lib/auth/jwt";
import { businessDate } from "@/lib/shifts";
import { logActivity } from "@/lib/activity";

// ---------------------------------------------------------------------------
//  Herramientas del asistente de CONSUMO DE COCINA — aisladas del de ventas.
//  La IA SOLO ve los insumos que la cocina puede registrar (consumo_visible y
//  no vendibles); por eso no puede registrar una cola/agua aunque se lo pidan.
//  Registrar reusa el RPC registrar_consumo (0016); corregir usa corregir_consumo.
// ---------------------------------------------------------------------------

export type Db = SupabaseClient<Database>;
export interface ToolCtx {
  db: Db;
  session: SessionClaims;
}
export interface ToolResult {
  message: string;
}

interface ConsumoTool {
  name: string;
  mode: "write";
  description: string;
  parameters: Record<string, unknown>;
  validate: (raw: unknown) => Record<string, unknown>;
  preview: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<string>;
  execute: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<ToolResult>;
}

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
const fmtNum = (n: number) => String(Math.round(n * 100) / 100);

// La unidad ES la presentación del insumo ("3 libras", "1 libra", "0.5 kilos").
const PLURAL: Record<string, string> = {
  unidad: "unidades", libra: "libras", kilo: "kilos", gramo: "gramos",
  funda: "fundas", litro: "litros", ml: "ml", presa: "presas", dedo: "dedos",
  bolsita: "bolsitas", vaso: "vasos", paquete: "paquetes",
};
const unitLabel = (unit: string | null, n: number) =>
  !unit ? "" : n === 1 ? unit : PLURAL[unit] ?? unit;
const qtyLabel = (n: number, unit: string | null) =>
  `${fmtNum(n)}${unit ? ` ${unitLabel(unit, n)}` : ""}`;

// ---------------------------------------------------------------------------
//  Insumos disponibles para consumo de cocina (lista + saldo + costo + hoy).
// ---------------------------------------------------------------------------
export interface Insumo {
  id: string;
  name: string;
  kind: string;
  unit: string | null;
  cost: number;
  stock: number;
  consumido_hoy: number;
}

export async function loadInsumos(ctx: ToolCtx): Promise<Insumo[]> {
  const { data } = await ctx.db.rpc("cocina_insumos_consumibles", {
    p_restaurant: ctx.session.restaurant_id,
    p_session: ctx.session.shift_session_id,
    p_date: businessDate(),
  });
  return ((data as unknown as Insumo[]) ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    kind: i.kind,
    unit: i.unit ?? null,
    cost: Number(i.cost) || 0,
    stock: Number(i.stock) || 0,
    consumido_hoy: Number(i.consumido_hoy) || 0,
  }));
}

/** Texto de la lista de insumos para el system prompt (con saldo y consumido). */
export function insumosPrompt(insumos: Insumo[]): string {
  if (insumos.length === 0)
    return "(no hay insumos marcados para consumo de cocina)";
  return insumos
    .map((i) => {
      const hoy = i.consumido_hoy > 0 ? `, hoy va ${qtyLabel(i.consumido_hoy, i.unit)}` : "";
      return `- ${i.name}: quedan ${qtyLabel(i.stock, i.unit)}${hoy}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
//  Resolución de nombres hablados → insumo (por coincidencia de palabras).
// ---------------------------------------------------------------------------
const STOP = new Set([
  "de", "con", "y", "la", "el", "los", "las", "un", "una", "unos", "unas",
  "del", "para", "por", "al", "a",
]);
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}
function bestInsumo(insumos: Insumo[], name: string): Insumo | null {
  const q = tokenize(name);
  if (q.length === 0) return null;
  let best: Insumo | null = null;
  let bestRatio = 0;
  let bestShared = 0;
  for (const i of insumos) {
    const c = tokenize(i.name);
    if (c.length === 0) continue;
    const shared = c.filter((w) => q.includes(w)).length;
    if (shared === 0) continue;
    const ratio = shared / c.length;
    if (ratio > bestRatio || (ratio === bestRatio && shared > bestShared)) {
      best = i;
      bestRatio = ratio;
      bestShared = shared;
    }
  }
  return best;
}

interface ItemIn {
  name: string;
  qty?: number;
  fraccion?: number;
}
interface Line {
  insumo: Insumo;
  qty: number;
}
interface Resolved {
  lines: Line[];
  notFound: string[];   // no está en consumo de cocina (ej. cola, agua)
  needQty: string[];    // sí existe pero no dijeron cuánto
  zero: string[];       // resuelto a 0 (ej. corregir algo que no se consumió hoy)
}

/**
 * Resuelve los ítems hablados a líneas con cantidad real. `base` decide sobre
 * qué se calcula la fracción ("todo"/"la mitad"): el SALDO al registrar, o lo
 * CONSUMIDO HOY al corregir (donde además se topa a ese consumido).
 */
function resolveLines(
  items: ItemIn[],
  insumos: Insumo[],
  base: "stock" | "consumido_hoy",
): Resolved {
  const lines: Line[] = [];
  const notFound: string[] = [];
  const needQty: string[] = [];
  const zero: string[] = [];
  for (const it of items) {
    const ins = bestInsumo(insumos, it.name);
    if (!ins) {
      notFound.push(it.name);
      continue;
    }
    let qty: number | null = null;
    if (it.fraccion != null) {
      const ref = base === "stock" ? ins.stock : ins.consumido_hoy;
      qty = Math.round(ref * it.fraccion * 100) / 100;
    } else if (it.qty != null) {
      qty = it.qty;
    }
    if (qty == null) {
      needQty.push(ins.name);
      continue;
    }
    if (base === "consumido_hoy") qty = Math.min(qty, ins.consumido_hoy);
    if (!(qty > 0)) {
      zero.push(ins.name);
      continue;
    }
    lines.push({ insumo: ins, qty });
  }
  return { lines, notFound, needQty, zero };
}

/** Notas (no encontrados / falta cantidad) para mostrar bajo la acción. */
function notas(r: Resolved, base: "stock" | "consumido_hoy"): string[] {
  const out: string[] = [];
  if (r.notFound.length)
    out.push(`⚠️ No está en consumo de cocina: ${r.notFound.join(", ")}.`);
  if (r.needQty.length) out.push(`¿Cuánto de ${r.needQty.join(", ")}?`);
  if (base === "consumido_hoy" && r.zero.length)
    out.push(`Hoy no hay consumo de ${r.zero.join(", ")} para corregir.`);
  return out;
}

async function logConsumo(
  ctx: ToolCtx,
  description: string,
  metadata: Record<string, unknown>,
  opId?: string | null,
) {
  await logActivity(ctx.db, {
    restaurantId: ctx.session.restaurant_id,
    userId: ctx.session.user_id,
    actorName: ctx.session.user_name,
    shiftSessionId: ctx.session.shift_session_id,
    source: "ia",
    event: "consumo",
    description,
    metadata,
    opId,
  });
}

// ---------------------------------------------------------------------------
//  Esquemas (las cantidades de cocina aceptan decimales: 0.5 kilos, 2.5 libras)
// ---------------------------------------------------------------------------
const itemSchema = z.object({
  name: z.string().min(1),
  qty: z.coerce.number().positive().optional(),
  fraccion: z.coerce.number().positive().max(1).optional(),
});
const consumoSchema = z.object({ items: z.array(itemSchema).min(1) });

const itemsParam = {
  type: "ARRAY",
  description: "Insumos de cocina con su cantidad.",
  items: {
    type: "OBJECT",
    properties: {
      name: { type: "STRING", description: "Nombre del insumo de cocina (arroz, tomate, huevo…)" },
      qty: {
        type: "NUMBER",
        description: "Cantidad exacta en la unidad del insumo (acepta decimales). Úsalo cuando digan un número, ej. 'dos libras' → 2.",
      },
      fraccion: {
        type: "NUMBER",
        description: "Parte del saldo (al registrar) o de lo consumido hoy (al corregir): 1=todo, 0.5=la mitad, 0.25=un cuarto, 0.75=tres cuartos. Úsalo cuando digan 'todo', 'la mitad', etc.",
      },
    },
    required: ["name"],
  },
};

// ---------------------------------------------------------------------------
//  Herramientas
// ---------------------------------------------------------------------------
export const CONSUMO_TOOLS: Record<string, ConsumoTool> = {
  // ============================ REGISTRAR CONSUMO ==========================
  registrar_consumo: {
    name: "registrar_consumo",
    mode: "write",
    description:
      "Registra lo que la COCINA gastó hoy para cocinar (descuenta del inventario y suma al costo del día). Acepta varios insumos. Úsalo para 'gasté dos libras de arroz y tres tomates', 'consumí todo el aceite', 'usé la mitad del pollo'. SOLO insumos de la lista de cocina; si no está, dilo y no lo registres.",
    parameters: {
      type: "OBJECT",
      properties: { items: itemsParam },
      required: ["items"],
    },
    validate: (raw) => consumoSchema.parse(raw),
    preview: async (args, ctx) => {
      const a = consumoSchema.parse(args);
      const insumos = await loadInsumos(ctx);
      const r = resolveLines(a.items, insumos, "stock");
      if (r.lines.length === 0) {
        const n = notas(r, "stock");
        throw new Error(
          n.length ? n.join(" ") : "No reconocí ningún insumo de cocina. Dime el nombre tal como está en la lista.",
        );
      }
      const body = r.lines
        .map((l) => {
          const queda = l.insumo.stock - l.qty;
          const saldo =
            queda < 0
              ? `  ⚠️ queda en ${qtyLabel(queda, l.insumo.unit)}`
              : `  (quedan ${qtyLabel(queda, l.insumo.unit)})`;
          return `•  ${qtyLabel(l.qty, l.insumo.unit)} de ${l.insumo.name}${saldo}`;
        })
        .join("\n");
      const extra = notas(r, "stock");
      return ["🍳 Registrar consumo de cocina", body, ...extra, "", "¿Confirmo?"].join("\n");
    },
    execute: async (args, ctx) => {
      const a = consumoSchema.parse(args);
      const insumos = await loadInsumos(ctx);
      const r = resolveLines(a.items, insumos, "stock");
      if (r.lines.length === 0) {
        const n = notas(r, "stock");
        throw new Error(n.length ? n.join(" ") : "No reconocí ningún insumo de cocina.");
      }
      const { data, error } = await ctx.db.rpc("registrar_consumo", {
        p_restaurant: ctx.session.restaurant_id,
        p_session: ctx.session.shift_session_id,
        p_user: ctx.session.user_id,
        p_date: businessDate(),
        p_items: r.lines.map((l) => ({ ingredient_id: l.insumo.id, qty: l.qty })) as unknown as Json,
      });
      if (error) throw new Error(error.message);
      const d = data as { total?: number; count?: number } | null;
      const total = Number(d?.total ?? 0);
      const desc = r.lines.map((l) => `${qtyLabel(l.qty, l.insumo.unit)} de ${l.insumo.name}`).join(", ");
      await logConsumo(ctx, `Consumo de cocina: ${desc} (${money(total)})`, {
        items: r.lines.length,
        total,
      });
      const body = r.lines
        .map((l) => `•  ${qtyLabel(l.qty, l.insumo.unit)} de ${l.insumo.name}`)
        .join("\n");
      return { message: `✅ Consumo registrado\n${body}\nCosto: ${money(total)}` };
    },
  },

  // ============================ CORREGIR CONSUMO ===========================
  corregir_consumo: {
    name: "corregir_consumo",
    mode: "write",
    description:
      "Deshace/corrige un consumo de cocina YA registrado HOY (devuelve el stock y baja el costo del día). Úsalo para 'me equivoqué, quita el arroz', 'corrige: eran dos libras no cinco' (quita 3), 'borra la mitad del consumo de tomate'. No se puede quitar más de lo consumido hoy.",
    parameters: {
      type: "OBJECT",
      properties: { items: itemsParam },
      required: ["items"],
    },
    validate: (raw) => consumoSchema.parse(raw),
    preview: async (args, ctx) => {
      const a = consumoSchema.parse(args);
      const insumos = await loadInsumos(ctx);
      const r = resolveLines(a.items, insumos, "consumido_hoy");
      if (r.lines.length === 0) {
        const n = notas(r, "consumido_hoy");
        throw new Error(
          n.length ? n.join(" ") : "No hay consumo de hoy que corregir para eso.",
        );
      }
      const body = r.lines
        .map(
          (l) =>
            `•  quitar ${qtyLabel(l.qty, l.insumo.unit)} de ${l.insumo.name}  (hoy va ${qtyLabel(
              l.insumo.consumido_hoy,
              l.insumo.unit,
            )})`,
        )
        .join("\n");
      const extra = notas(r, "consumido_hoy");
      return ["↩️ Corregir consumo de cocina", body, ...extra, "", "¿Confirmo?"].join("\n");
    },
    execute: async (args, ctx) => {
      const a = consumoSchema.parse(args);
      const insumos = await loadInsumos(ctx);
      const r = resolveLines(a.items, insumos, "consumido_hoy");
      if (r.lines.length === 0) {
        const n = notas(r, "consumido_hoy");
        throw new Error(n.length ? n.join(" ") : "No hay consumo de hoy que corregir.");
      }
      const { data, error } = await ctx.db.rpc("corregir_consumo", {
        p_restaurant: ctx.session.restaurant_id,
        p_session: ctx.session.shift_session_id,
        p_user: ctx.session.user_id,
        p_date: businessDate(),
        p_items: r.lines.map((l) => ({ ingredient_id: l.insumo.id, qty: l.qty })) as unknown as Json,
      });
      if (error) throw new Error(error.message);
      const d = data as { total?: number; count?: number; op_id?: string } | null;
      const total = Number(d?.total ?? 0);
      const desc = r.lines.map((l) => `${qtyLabel(l.qty, l.insumo.unit)} de ${l.insumo.name}`).join(", ");
      await logConsumo(
        ctx,
        `Corrección de consumo: ${desc} (devuelto ${money(total)})`,
        { correccion: true, items: r.lines.length, total },
        d?.op_id ?? null,
      );
      const body = r.lines
        .map((l) => `•  ${qtyLabel(l.qty, l.insumo.unit)} de ${l.insumo.name} devuelto`)
        .join("\n");
      return { message: `↩️ Consumo corregido\n${body}\nSe repuso ${money(total)} al inventario.` };
    },
  },
};

export function getConsumoTool(name: string): ConsumoTool | undefined {
  return CONSUMO_TOOLS[name];
}

/** Declaraciones para Gemini (solo las herramientas de cocina). */
export const consumoFunctionDeclarations = Object.values(CONSUMO_TOOLS).map((t) => ({
  name: t.name,
  description: t.description,
  parameters: t.parameters,
}));

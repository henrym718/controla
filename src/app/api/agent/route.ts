import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { transcribe } from "@/lib/agent/whisper";
import { runAgent, type AgentTurn } from "@/lib/agent/gemini";
import {
  geminiFunctionDeclarations,
  getTool,
  type ToolCtx,
} from "@/lib/agent/tools";
import { businessDate } from "@/lib/shifts";
import type { SessionClaims } from "@/lib/auth/jwt";

export const runtime = "nodejs";

function buildSystem(
  session: SessionClaims,
  menu: string,
  productos: string,
  catalog: string,
  insumos: string,
): string {
  return [
    "Eres el asistente de 'Controla', una app de control de un restaurante pequeño en Ecuador.",
    `Usuaria: ${session.user_name} (${session.user_role}).`,
    "Tu trabajo: convertir lo que dice la usuaria en una acción usando las herramientas disponibles.",
    "Reglas:",
    "- Responde SIEMPRE en español de Ecuador, breve y claro.",
    "- Usa una herramienta cuando la intención sea clara. Si falta un dato esencial, pregúntalo en una frase.",
    "- Si la usuaria dicta VARIAS cosas en un mismo mensaje (ej. 'ingresa 20 gaseosas a $5 y también 100 discos de empanada a $20'), devuelve TODAS las llamadas a funciones necesarias, UNA por cada acción. No te quedes solo con la primera.",
    "- VENDER: usa el precio del MENÚ DE HOY. Si el plato no está en el menú ni en el catálogo, pregunta si se agrega y a qué precio. SIEMPRE confirma el precio, aunque ya esté en el catálogo.",
    "- COMBO (sopa + segundo juntos a precio especial): aparece en el MENÚ DE HOY marcado '(combo)'. Si piden el combo, véndelo con su precio. Si piden SOLO la sopa o SOLO el segundo, vende cada uno por separado con su precio individual.",
    "- ADICIONAL (huevo extra, porción): aparece marcado '(adicional)'. Véndelo como una venta más; descuenta su insumo solo.",
    "- ARMAR un combo nuevo (no venderlo): usa crear_combo con la sopa y el segundo que ya existen en el catálogo.",
    "- Las colas/bebidas y demás PRODUCTOS del inventario se venden directo y descuentan stock.",
    "- 'Para llevar': se consume un envase (lonchera, bandeja, vaso). Si no está claro cuál, pregúntalo.",
    "- GASTO (servilletas, escoba, gas, servicios) NO es inventario → usa registrar_gasto. COMPRA de algo que ENTRA al inventario (arroz, aceite, colas) → usa registrar_compra.",
    "- En gastos y compras, pregunta si el dinero salió de la CAJA o lo puso la JEFA (fuente_pago).",
    "- Producción: si dicen cuántas unidades salieron (presas, bolsitas) es contable; si no (arroz, sopa), es a granel.",
    "- CONSUMO del día para cocinar, sin venderlo y sin nombrar un resultado (ej. 'consumimos 4 tomates', 'usamos 10 huevos hoy') → usa consumir_insumo: baja el stock y suma su costo al pool/costo del día de HOY. NO preguntes el costo.",
    "- COMIDA DE EMPLEADA (consumo interno, gratis): ej. 'voy a comer mi almuerzo', 'me sirvo un seco', 'consumo el combo' → usa consumir_interno con el plato/sopa/combo. Se registra a $0 a su nombre (descuenta su proteína, entra al pool, NO es venta).",
    "- Al COMPRAR algo que YA existe en el inventario, NO vuelvas a preguntar el precio de venta (ya está guardado) ni el costo unitario: el costo se promedia solo con lo que había.",
    "- Para retiros de caja o de inventario, el motivo es obligatorio.",
    "- ANULAR/REVERSAR (ej. 'anula la última venta', 'devolvieron las 2 colas', 'reversa la compra de arroz') → usa anular_operacion con el tipo (venta/compra/gasto/caja) y una pista de cuál. Pedirá el PIN de administradora al confirmar.",
    "- La app pedirá confirmación antes de guardar; tú solo decide la acción.",
    "",
    "MENÚ DE HOY (este turno) — usa estos precios al vender:",
    menu,
    "",
    "Productos del inventario a la venta (nombre: precio):",
    productos,
    "",
    "Catálogo de platos (para fijar el menú o definir recetas):",
    catalog,
    "",
    "Insumos conocidos:",
    insumos,
  ].join("\n");
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const db = createAdminClient();
  const ctx: ToolCtx = { db, session };

  let userText = "";
  let history: AgentTurn[] = [];

  const ctype = req.headers.get("content-type") ?? "";
  try {
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const audio = form.get("audio");
      const histRaw = form.get("history");
      if (typeof histRaw === "string") history = JSON.parse(histRaw);
      if (audio instanceof Blob) userText = await transcribe(audio, "audio.webm");
    } else {
      const json = (await req.json()) as { text?: string; history?: AgentTurn[] };
      userText = String(json.text ?? "");
      history = json.history ?? [];
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error leyendo la petición";
    return NextResponse.json({ transcript: "", reply: `⚠️ ${msg}`, action: null });
  }

  if (!userText.trim()) {
    return NextResponse.json({ error: "Sin contenido" }, { status: 400 });
  }

  const today = businessDate();
  const [{ data: menuRows }, { data: dishes }, { data: ings }] = await Promise.all([
    db
      .from("daily_menu")
      .select("price,available,dishes(name,is_combo,is_extra)")
      .eq("restaurant_id", session.restaurant_id)
      .eq("business_date", today)
      .eq("shift_id", session.shift_id)
      .order("sort_order"),
    db
      .from("dishes")
      .select("name,price")
      .eq("restaurant_id", session.restaurant_id)
      .eq("active", true),
    db
      .from("ingredients")
      .select("name,kind,consumption_unit,is_sellable,sale_price")
      .eq("restaurant_id", session.restaurant_id)
      .eq("active", true),
  ]);

  const menu =
    (menuRows ?? [])
      .filter((m) => m.available)
      .map((m) => {
        const d = m.dishes as unknown as { name: string; is_combo: boolean; is_extra: boolean } | null;
        const tag = d?.is_combo ? " (combo)" : d?.is_extra ? " (adicional)" : "";
        return `- ${d?.name ?? "?"}${tag}: $${Number(m.price).toFixed(2)}`;
      })
      .join("\n") || "(sin menú fijado para este turno)";
  const productos =
    (ings ?? [])
      .filter((i) => i.is_sellable)
      .map((i) => `- ${i.name}: $${Number(i.sale_price ?? 0).toFixed(2)}`)
      .join("\n") || "(sin productos a la venta)";
  const catalog =
    (dishes ?? []).map((d) => `- ${d.name}: $${d.price}`).join("\n") ||
    "(sin platos aún)";
  const insumos =
    (ings ?? [])
      .filter((i) => !i.is_sellable)
      .map(
        (i) =>
          `- ${i.name} (${i.kind}${i.consumption_unit ? `, en ${i.consumption_unit}` : ""})`,
      )
      .join("\n") || "(sin insumos aún)";

  const turns: AgentTurn[] = [...history, { role: "user", text: userText }];

  let decision;
  try {
    decision = await runAgent({
      systemInstruction: buildSystem(session, menu, productos, catalog, insumos),
      history: turns,
      functionDeclarations: geminiFunctionDeclarations,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error del agente";
    return NextResponse.json({ transcript: userText, reply: `⚠️ ${msg}`, action: null });
  }

  if (decision.functionCalls?.length) {
    // Puede haber VARIAS acciones en un solo dictado: se procesan todas.
    const actions: {
      tool: string;
      args: Record<string, unknown>;
      preview: string;
      requiresPin?: boolean;
    }[] = [];
    const notas: string[] = [];

    for (const fc of decision.functionCalls) {
      const tool = getTool(fc.name);
      if (!tool) {
        notas.push("No reconocí una de las acciones.");
        continue;
      }
      try {
        const args = tool.validate(fc.args);
        if (tool.mode === "read") {
          const r = await tool.execute(args, ctx);
          notas.push(r.message);
        } else {
          const preview = tool.preview ? await tool.preview(args, ctx) : "¿Confirmo esta acción?";
          actions.push({ tool: tool.name, args, preview, requiresPin: tool.requiresPin });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "No pude preparar una acción";
        notas.push(`⚠️ ${msg}`);
      }
    }

    if (actions.length) {
      const lista = actions
        .map((a, i) => (actions.length > 1 ? `${i + 1}. ${a.preview}` : a.preview))
        .join("\n");
      const reply = [lista, ...notas].filter(Boolean).join("\n");
      return NextResponse.json({ transcript: userText, reply, actions });
    }
    return NextResponse.json({
      transcript: userText,
      reply: notas.join("\n") || "Listo",
      actions: [],
    });
  }

  return NextResponse.json({
    transcript: userText,
    reply: decision.text,
    actions: [],
  });
}

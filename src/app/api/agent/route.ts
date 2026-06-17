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
import { menuShiftIds, dedupeMenu } from "@/lib/menu";
import type { SessionClaims } from "@/lib/auth/jwt";

export const runtime = "nodejs";

function buildSystem(
  session: SessionClaims,
  menu: string,
  adicionales: string,
  productos: string,
  clientes: string,
  cuentas: string,
): string {
  return [
    "Eres el asistente de VENTAS de 'Controla', una app de un restaurante pequeño en Ecuador.",
    `Usuaria: ${session.user_name} (${session.user_role}).`,
    "Tu único trabajo es REGISTRAR VENTAS por voz: hacer lo mismo que el módulo de 'Registrar venta' de la app. Convierte lo que dice la usuaria en acciones usando SOLO las herramientas disponibles.",
    "NO haces nada fuera de ventas (ni compras, ni gastos, ni inventario, ni caja, ni cierres). Si te piden algo así, di amablemente que aquí solo registras ventas.",
    "Reglas:",
    "- Responde SIEMPRE en español de Ecuador, breve y claro.",
    "- Usa la herramienta apenas la intención sea clara. Si falta un dato esencial, pregúntalo en una sola frase.",
    "- MULTITAREA: si la usuaria dicta varias cosas en un mensaje (ej. 'cobra un seco con una cola, y abre la mesa 4 con 2 almuerzos'), devuelve TODAS las llamadas necesarias, una por acción. No te quedes con la primera.",
    "- Agrupa en UNA sola venta/cuenta los ítems que van juntos: un mismo pedido (plato + adicional + bebida) es UNA llamada con varios items, no varias.",
    "- SOLO vendes platos del MENÚ DE HOY y productos de la lista; nunca inventes platos ni uses unos que no estén en el menú de hoy. Si no encuentras lo que piden, pide que repitan el nombre o digan a cuál plato del menú se refieren.",
    "- AGOTADO: un plato marcado '(AGOTADO)' en el menú de hoy sigue existiendo. Si lo piden, intenta venderlo igual: la app te ofrecerá reactivarlo y registrar la venta al confirmar.",
    "- COMBO: aparece en el MENÚ DE HOY marcado '(combo)'. Si piden el combo, véndelo con su precio. Si piden solo la sopa o solo el segundo, usa el ítem individual.",
    "- ADICIONALES (huevo extra, tortilla de verde, porción…): están SIEMPRE disponibles aunque no estén en el menú de hoy; búscalos en la lista 'Adicionales'. Las BEBIDAS/PRODUCTOS (cola, agua) están en su lista. Todos pueden ir en una venta normal, a crédito o en una mesa.",
    "- DESAMBIGUA cuando el pedido sea vago: ej. 'una tortilla de verde y un café' puede ser DOS adicionales por separado, PERO también puede existir un COMBO ('Tortilla de verde + café' o '… + huevo frito'). Mira si hay un combo que calce. Si lo hay y no está claro cuál quieren, NO asumas: pregunta en una frase '¿el combo Tortilla+café ($X) o la tortilla y el café por separado?' y solo registra cuando confirmen.",
    "- VENTA AL CONTADO (efectivo) → registrar_venta.",
    "- VENTA A CRÉDITO/FIADO a una persona registrada (ej. 'fíale a Juan') → registrar_credito con su nombre. Si no encuentras a la persona, dilo; no inventes nombres.",
    "- CUENTAS POR COBRAR / MESAS: 'abre/registra la mesa N con…' → crear_cuenta. 'a la mesa N agrégale/quítale/pon X' → modificar_cuenta (op agregar/quitar/fijar). 'cobra la mesa N' → cobrar_cuenta. 'elimina/anula la mesa N' → eliminar_cuenta.",
    "- Para cobrar, modificar o eliminar una mesa, esa cuenta debe EXISTIR ya (mira 'Cuentas abiertas'). Si pides crearla y cobrarla a la vez, primero créala.",
    "- CONSUMO PROPIO (comida gratis de la empleada): 'voy a comer mi almuerzo', 'me sirvo un seco' → consumo_propio. SOLO el plato principal es gratis; las bebidas y adicionales NO son gratis (esos van como venta normal).",
    "- La app SIEMPRE pide confirmación antes de guardar; tú solo decides y describes la acción.",
    "",
    "MENÚ DE HOY (este turno) — platos principales y combos, con su precio:",
    menu,
    "",
    "Adicionales (siempre disponibles, no dependen del menú de hoy):",
    adicionales,
    "",
    "Productos del inventario a la venta (nombre: precio):",
    productos,
    "",
    "Personas registradas (para venta a crédito):",
    clientes,
    "",
    "Cuentas abiertas (mesas pendientes de cobro):",
    cuentas,
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
  // Menú efectivo del turno = lo de ESTE turno + lo de "Todo el día".
  const shiftIds = await menuShiftIds(db, session.restaurant_id, session.shift_id);
  const [
    { data: menuRows },
    { data: extras },
    { data: ings },
    { data: clientesRows },
    { data: cuentasRows },
  ] = await Promise.all([
    db
      .from("daily_menu")
      .select("dish_id,shift_id,price,available,dishes(name,is_combo,is_extra)")
      .eq("restaurant_id", session.restaurant_id)
      .eq("business_date", today)
      .in("shift_id", shiftIds)
      .order("sort_order"),
    db
      .from("dishes")
      .select("name,price")
      .eq("restaurant_id", session.restaurant_id)
      .eq("is_extra", true)
      .eq("active", true)
      .order("name"),
    db
      .from("ingredients")
      .select("name,is_sellable,sale_price")
      .eq("restaurant_id", session.restaurant_id)
      .eq("is_sellable", true)
      .eq("active", true),
    db
      .from("clientes")
      .select("name,kind")
      .eq("restaurant_id", session.restaurant_id)
      .eq("active", true)
      .order("name"),
    db
      .from("cuentas_mesa")
      .select("label,total,items")
      .eq("restaurant_id", session.restaurant_id)
      .eq("status", "abierta")
      .order("created_at"),
  ]);

  // El menú de hoy lista principales y combos; los adicionales van en su propia
  // lista (están siempre disponibles, no dependen del menú del día).
  const menu =
    dedupeMenu(menuRows ?? [], session.shift_id)
      .filter((m) => {
        const d = m.dishes as unknown as { is_extra: boolean } | null;
        return !d?.is_extra;
      })
      .map((m) => {
        const d = m.dishes as unknown as { name: string; is_combo: boolean } | null;
        const tags: string[] = [];
        if (d?.is_combo) tags.push("combo");
        if (!m.available) tags.push("AGOTADO");
        const tag = tags.length ? ` (${tags.join(", ")})` : "";
        return `- ${d?.name ?? "?"}${tag}: $${Number(m.price).toFixed(2)}`;
      })
      .join("\n") || "(sin menú fijado para este turno)";
  const adicionales =
    (extras ?? [])
      .map((d) => `- ${d.name}: $${Number(d.price).toFixed(2)}`)
      .join("\n") || "(sin adicionales)";
  const productos =
    (ings ?? [])
      .map((i) => `- ${i.name}: $${Number(i.sale_price ?? 0).toFixed(2)}`)
      .join("\n") || "(sin productos a la venta)";
  const clientes =
    (clientesRows ?? [])
      .map((c) => `- ${c.name} (${c.kind})`)
      .join("\n") || "(sin personas registradas)";
  const cuentas =
    (cuentasRows ?? [])
      .map((c) => {
        const items = (c.items as unknown as { name: string; qty: number }[]) ?? [];
        const detalle = items.map((i) => `${i.qty}×${i.name}`).join(", ");
        return `- ${c.label}: ${detalle || "vacía"} ($${Number(c.total).toFixed(2)})`;
      })
      .join("\n") || "(no hay cuentas abiertas)";

  const turns: AgentTurn[] = [...history, { role: "user", text: userText }];

  let decision;
  try {
    decision = await runAgent({
      systemInstruction: buildSystem(session, menu, adicionales, productos, clientes, cuentas),
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
          actions.push({ tool: tool.name, args, preview });
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

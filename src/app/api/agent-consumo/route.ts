import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { transcribe } from "@/lib/agent/whisper";
import { runAgent, type AgentTurn } from "@/lib/agent/gemini";
import {
  consumoFunctionDeclarations,
  getConsumoTool,
  loadInsumos,
  insumosPrompt,
  type ToolCtx,
} from "@/lib/agent/consumo-tools";
import type { SessionClaims } from "@/lib/auth/jwt";

export const runtime = "nodejs";

function buildSystem(session: SessionClaims, insumos: string): string {
  return [
    "Eres el asistente de CONSUMO DE COCINA de 'Controla', una app de un restaurante pequeño en Ecuador.",
    `Usuaria: ${session.user_name} (${session.user_role}).`,
    "Tu ÚNICO trabajo es registrar (y corregir) lo que la COCINA gastó para cocinar: insumos como arroz, tomate, huevo, aceite, verde… Haces lo mismo que el módulo 'Registrar consumo de cocina', pero por voz.",
    "NO vendes nada, ni cobras, ni tocas la caja, las mesas, los gastos, las compras ni el consumo propio de las empleadas. Si te piden algo así, di amablemente que aquí solo registras el consumo de la cocina.",
    "SOLO puedes usar los insumos de la lista 'Insumos de cocina' de abajo. Si te piden un producto que no está ahí (una cola, un agua, o cualquier producto de venta), responde que ese producto NO está disponible para consumo de cocina y NO lo registres.",
    "Reglas:",
    "- Responde SIEMPRE en español de Ecuador, breve y claro.",
    "- Usa la herramienta apenas la intención sea clara. Si falta la cantidad de un insumo, pregúntala en una sola frase.",
    "- MULTITAREA: si dictan varios insumos en un mensaje (ej. 'gasté dos libras de arroz, tres tomates y un poco de aceite'), devuelve TODOS los ítems en una sola llamada.",
    "- CANTIDADES EXACTAS: si dan un número, usa qty en la unidad del insumo (acepta decimales): 'dos libras de arroz' → qty 2; 'medio kilo' → qty 0.5.",
    "- CANTIDADES RELATIVAS: si dicen una PARTE de lo que hay —'todo', 'la mitad', 'un cuarto', 'tres cuartos'— usa fraccion (1, 0.5, 0.25, 0.75) en vez de qty. Al REGISTRAR, la fracción es sobre el SALDO que ves en la lista ('todo el arroz' = fraccion 1 = lo que queda). El sistema calcula la cantidad exacta; no la adivines tú.",
    "- CORREGIR: si se equivocaron y quieren deshacer ('quita el arroz', 'me equivoqué', 'eran dos no cinco', 'borra el consumo de tomate') usa corregir_consumo. Ahí 'todo' o 'la mitad' es sobre lo CONSUMIDO HOY (no sobre el saldo). No se puede corregir más de lo consumido hoy.",
    "- Se puede registrar aunque el saldo quede en negativo (la app lo muestra); no bloquees por falta de stock.",
    "- El costo se hereda del inventario: NUNCA preguntes ni pidas el costo.",
    "- La app SIEMPRE pide confirmación antes de guardar; tú solo decides y describes la acción.",
    "",
    "Insumos de cocina disponibles (nombre — saldo que queda — lo consumido hoy):",
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
    return NextResponse.json({ transcript: "", reply: `⚠️ ${msg}`, actions: [] });
  }

  if (!userText.trim()) {
    return NextResponse.json({ error: "Sin contenido" }, { status: 400 });
  }

  const insumos = await loadInsumos(ctx);
  const turns: AgentTurn[] = [...history, { role: "user", text: userText }];

  let decision;
  try {
    decision = await runAgent({
      systemInstruction: buildSystem(session, insumosPrompt(insumos)),
      history: turns,
      functionDeclarations: consumoFunctionDeclarations,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error del agente";
    return NextResponse.json({ transcript: userText, reply: `⚠️ ${msg}`, actions: [] });
  }

  if (decision.functionCalls?.length) {
    const actions: { tool: string; args: Record<string, unknown>; preview: string }[] = [];
    const notasArr: string[] = [];

    for (const fc of decision.functionCalls) {
      const tool = getConsumoTool(fc.name);
      if (!tool) {
        notasArr.push("No reconocí una de las acciones (aquí solo registro consumo de cocina).");
        continue;
      }
      try {
        const args = tool.validate(fc.args);
        const preview = await tool.preview(args, ctx);
        actions.push({ tool: tool.name, args, preview });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "No pude preparar una acción";
        notasArr.push(`⚠️ ${msg}`);
      }
    }

    if (actions.length) {
      const lista = actions
        .map((a, i) => (actions.length > 1 ? `${i + 1})  ${a.preview}` : a.preview))
        .join("\n\n");
      const reply = [lista, ...notasArr].filter(Boolean).join("\n\n");
      return NextResponse.json({ transcript: userText, reply, actions });
    }
    return NextResponse.json({
      transcript: userText,
      reply: notasArr.join("\n") || "Listo",
      actions: [],
    });
  }

  return NextResponse.json({
    transcript: userText,
    reply: decision.text,
    actions: [],
  });
}

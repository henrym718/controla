import { NextResponse } from "next/server";
import { getSession, clearSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTool, type ToolCtx } from "@/lib/agent/tools";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = (await req.json()) as {
    tool?: string;
    args?: unknown;
    actions?: { tool: string; args: unknown }[];
    pin?: string;
  };
  // Acepta una sola acción {tool,args} o varias {actions:[...]}.
  const actions =
    body.actions && Array.isArray(body.actions)
      ? body.actions
      : body.tool
        ? [{ tool: body.tool, args: body.args }]
        : [];

  if (actions.length === 0) {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }

  const db = createAdminClient();
  // El PIN (si lo hay) viaja en el contexto para las acciones sensibles (anular).
  const ctx: ToolCtx = { db, session, pin: body.pin };

  const results: { ok: boolean; reply: string }[] = [];
  let loggedOut = false;

  for (const a of actions) {
    const tool = a.tool ? getTool(a.tool) : undefined;
    if (!tool || tool.mode !== "write") {
      results.push({ ok: false, reply: "⚠️ Acción inválida" });
      continue;
    }
    try {
      const parsed = tool.validate(a.args);
      const result = await tool.execute(parsed, ctx);
      if (result.loggedOut) loggedOut = true;
      results.push({ ok: true, reply: result.message });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo guardar";
      results.push({ ok: false, reply: `⚠️ ${msg}` });
    }
  }

  // El cierre de turno saca de la sesión: aplicar al final, tras ejecutar todo.
  if (loggedOut) await clearSession();

  return NextResponse.json({
    ok: results.every((r) => r.ok),
    results,
    reply: results.map((r) => r.reply).join("\n"),
    loggedOut,
  });
}

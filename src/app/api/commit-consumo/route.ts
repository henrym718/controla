import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getConsumoTool, type ToolCtx } from "@/lib/agent/consumo-tools";

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
  const ctx: ToolCtx = { db, session };

  const results: { ok: boolean; reply: string }[] = [];

  for (const a of actions) {
    const tool = a.tool ? getConsumoTool(a.tool) : undefined;
    if (!tool) {
      results.push({ ok: false, reply: "⚠️ Acción inválida" });
      continue;
    }
    try {
      const parsed = tool.validate(a.args);
      const result = await tool.execute(parsed, ctx);
      results.push({ ok: true, reply: result.message });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo guardar";
      results.push({ ok: false, reply: `⚠️ ${msg}` });
    }
  }

  return NextResponse.json({
    ok: results.every((r) => r.ok),
    results,
    reply: results.map((r) => r.reply).join("\n"),
  });
}

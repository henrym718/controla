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

  const { tool: name, args } = (await req.json()) as {
    tool?: string;
    args?: unknown;
  };
  const tool = name ? getTool(name) : undefined;
  if (!tool || tool.mode !== "write") {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }

  const db = createAdminClient();
  const ctx: ToolCtx = { db, session };

  try {
    const parsed = tool.validate(args);
    const result = await tool.execute(parsed, ctx);
    if (result.loggedOut) await clearSession();
    return NextResponse.json({
      ok: true,
      reply: result.message,
      loggedOut: !!result.loggedOut,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "No se pudo guardar";
    return NextResponse.json({ ok: false, reply: `⚠️ ${msg}` }, { status: 200 });
  }
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.user_role !== "admin")
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  if (!from || !to) return NextResponse.json({ error: "Falta el rango" }, { status: 400 });
  const category = sp.get("category") || undefined;
  const event = sp.get("event") || undefined;

  const db = createAdminClient();
  const { data, error } = await db.rpc("bitacora_listar", {
    p_restaurant: session.restaurant_id,
    p_from: from,
    p_to: to,
    p_category: category,
    p_event: event,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

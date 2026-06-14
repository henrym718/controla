import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.user_role !== "admin")
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const date = new URL(req.url).searchParams.get("date");
  if (!date) return NextResponse.json({ error: "Falta date" }, { status: 400 });

  const db = createAdminClient();
  const { data, error } = await db.rpc("conteo_estado", {
    p_restaurant: session.restaurant_id,
    p_date: date,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}

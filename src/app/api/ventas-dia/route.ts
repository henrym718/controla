import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeDaySales } from "@/lib/reports";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (session.user_role !== "admin")
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const date = new URL(req.url).searchParams.get("date");
  if (!date) return NextResponse.json({ error: "Falta date" }, { status: 400 });

  const db = createAdminClient();
  const data = await computeDaySales(db, session.restaurant_id, date);
  return NextResponse.json(data);
}

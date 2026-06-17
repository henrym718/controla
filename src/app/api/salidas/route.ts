import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeDaySalidas } from "@/lib/reports";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const date = new URL(req.url).searchParams.get("date");
  if (!date) return NextResponse.json({ error: "Falta date" }, { status: 400 });

  const db = createAdminClient();
  const salidas = await computeDaySalidas(db, session.restaurant_id, date);
  return NextResponse.json(salidas);
}

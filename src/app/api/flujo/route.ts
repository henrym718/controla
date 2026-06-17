import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeFlujoCaja } from "@/lib/reports";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const db = createAdminClient();
  const flujo = await computeFlujoCaja(db, session.restaurant_id);
  return NextResponse.json(flujo);
}

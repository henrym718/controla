import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import CierreClient, { type CierreResumen } from "./cierre-client";

const EMPTY = { total: 0, items: [] as never[] };

export default async function CierrePage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);

  const db = createAdminClient();
  const { data } = await db.rpc("resumen_turno", {
    p_session_id: session.shift_session_id,
  });

  let resumen = data as unknown as CierreResumen | null;

  // Fallback defensivo: si la RPC aún no existe (migración 0008 sin aplicar),
  // arma un resumen mínimo desde la vista de caja para no romper el cierre.
  if (!resumen) {
    const { data: caja } = await db
      .from("v_caja_turno")
      .select("caja_esperada,opening_cash")
      .eq("shift_session_id", session.shift_session_id)
      .maybeSingle();
    resumen = {
      session_id: session.shift_session_id,
      shift: null,
      responsable: session.user_name,
      ventas: { total: 0, efectivo: 0, transferencia: 0, otro: 0, n: 0 },
      gastos: EMPTY,
      egresos: EMPTY,
      aportes: 0,
      caja: {
        apertura: Number(caja?.opening_cash ?? 0),
        esperada: Number(caja?.caja_esperada ?? 0),
      },
    };
  }

  return <CierreClient slug={restaurante} resumen={resumen} />;
}

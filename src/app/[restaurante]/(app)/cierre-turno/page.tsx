import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import CierreClient, { type CierreResumen } from "./cierre-client";

const EMPTY = { total: 0, items: [] as never[] };

export default async function CierrePage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurante: string }>;
  searchParams: Promise<{ e?: string }>;
}) {
  const { restaurante } = await params;
  const { e } = await searchParams;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);

  const db = createAdminClient();

  // Conteo bloqueado (anti-robo): si la encargada ya registró el efectivo, la
  // pantalla salta directo al cuadre y NO vuelve a pedirlo (ni la deja cambiarlo).
  const { data: ssRow } = await db
    .from("shift_sessions")
    .select("counted_cash,counted_at")
    .eq("id", session.shift_session_id)
    .maybeSingle();
  const contada = ssRow?.counted_cash == null ? null : Number(ssRow.counted_cash);
  const conteoBloqueado = ssRow?.counted_at != null;

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

  // Detalle de lo vendido en el turno (para que la encargada vea qué registró).
  const { data: salesRows } = await db
    .from("sales")
    .select("dish_name,qty,total")
    .eq("shift_session_id", session.shift_session_id)
    .is("voided_at", null)
    .eq("consumo_interno", false);
  const detMap = new Map<string, { qty: number; total: number }>();
  for (const s of salesRows ?? []) {
    const k = s.dish_name ?? "—";
    const e = detMap.get(k) ?? { qty: 0, total: 0 };
    e.qty += Number(s.qty);
    e.total += Number(s.total);
    detMap.set(k, e);
  }
  const ventasDetalle = [...detMap.entries()]
    .map(([name, v]) => ({ name, qty: v.qty, total: v.total }))
    .sort((a, b) => b.total - a.total);

  // Crédito y cuentas de mesa (informativo; no afectan el cuadre de caja):
  //  - ventas a crédito de este turno (no es efectivo; se cobra después)
  //  - cobros de crédito recibidos (ya van dentro de los aportes/ingresos)
  //  - cuentas de mesa abiertas (comida ya servida sin cobrar → avisar)
  const [{ data: creditoRows }, { data: cobroRows }, { data: cuentasRows }] =
    await Promise.all([
      db
        .from("sales")
        .select("total")
        .eq("shift_session_id", session.shift_session_id)
        .eq("payment_method", "credito")
        .is("voided_at", null),
      db
        .from("cash_movements")
        .select("amount")
        .eq("shift_session_id", session.shift_session_id)
        .eq("categoria", "cobro_credito")
        .is("voided_at", null),
      db
        .from("cuentas_mesa")
        .select("total")
        .eq("restaurant_id", session.restaurant_id)
        .eq("status", "abierta"),
    ]);
  const credito = (creditoRows ?? []).reduce((s, r) => s + Number(r.total), 0);
  const cobrosCredito = (cobroRows ?? []).reduce((s, r) => s + Number(r.amount), 0);
  const cuentasMesa = {
    count: (cuentasRows ?? []).length,
    total: (cuentasRows ?? []).reduce((s, r) => s + Number(r.total), 0),
  };

  return (
    <CierreClient
      slug={restaurante}
      resumen={resumen}
      ventasDetalle={ventasDetalle}
      credito={credito}
      cobrosCredito={cobrosCredito}
      cuentasMesa={cuentasMesa}
      contada={contada}
      conteoBloqueado={conteoBloqueado}
      errorConteo={e === "1"}
    />
  );
}

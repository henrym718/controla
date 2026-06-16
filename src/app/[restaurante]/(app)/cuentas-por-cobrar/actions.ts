"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth/session";
import { logActivity } from "@/lib/activity";

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

export interface CobroResult {
  error?: string;
  ok?: boolean;
}

/**
 * Cobra (parte de) la deuda de un cliente. El dinero entra a la caja del turno
 * como ingreso etiquetado 'cobro_credito' (lo ve el cuadre) sin volver a contar
 * venta ni costo. Lo pueden hacer las cajeras (no exige PIN de admin).
 */
export async function registrarCobroCredito(
  clienteId: string,
  amount: number,
): Promise<CobroResult> {
  const session = await getSession();
  if (!session) return { error: "Sesión expirada. Vuelve a entrar." };
  if (!clienteId) return { error: "Falta la persona." };
  if (!(amount > 0)) return { error: "El monto debe ser mayor a 0." };

  const db = createAdminClient();
  const { data, error } = await db.rpc("registrar_cobro_credito", {
    p_restaurant: session.restaurant_id,
    p_session: session.shift_session_id,
    p_user: session.user_id,
    p_cliente_id: clienteId,
    p_amount: amount,
  });
  if (error) return { error: error.message };

  const d = data as { op_id?: string } | null;
  await logActivity(db, {
    restaurantId: session.restaurant_id,
    userId: session.user_id,
    actorName: session.user_name,
    shiftSessionId: session.shift_session_id,
    source: "manual",
    event: "ingreso_caja",
    description: `Cobro de crédito: ${money(amount)}`,
    metadata: { cobro_credito: true, cliente_id: clienteId, amount },
    opId: d?.op_id ?? null,
  });

  revalidatePath(`/${session.slug}/cuentas-por-cobrar`);
  revalidatePath(`/${session.slug}/hoy`);
  return { ok: true };
}

export interface HistorialItem {
  ts: string;
  fecha: string;
  tipo: "cargo" | "abono";
  concepto: string;
  monto: number;
}
export interface HistorialResult {
  name: string;
  saldo: number;
  items: HistorialItem[];
}

/** Historial de una persona: sus cargos (ventas a crédito) y abonos (cobros). */
export async function historialCliente(clienteId: string): Promise<HistorialResult> {
  const session = await getSession();
  if (!session) return { name: "", saldo: 0, items: [] };
  const db = createAdminClient();
  const [{ data: ventas }, { data: cobros }, { data: saldo }] = await Promise.all([
    db
      .from("sales")
      .select("business_date,created_at,dish_name,qty,total")
      .eq("restaurant_id", session.restaurant_id)
      .eq("cliente_id", clienteId)
      .eq("payment_method", "credito")
      .is("voided_at", null)
      .order("created_at", { ascending: false }),
    db
      .from("cash_movements")
      .select("created_at,amount")
      .eq("restaurant_id", session.restaurant_id)
      .eq("cliente_id", clienteId)
      .eq("categoria", "cobro_credito")
      .is("voided_at", null)
      .order("created_at", { ascending: false }),
    db.from("v_saldos_credito").select("name,saldo").eq("cliente_id", clienteId).maybeSingle(),
  ]);

  const items: HistorialItem[] = [];
  for (const v of ventas ?? []) {
    items.push({
      ts: v.created_at ?? v.business_date,
      fecha: v.business_date,
      tipo: "cargo",
      concepto: `${v.qty} × ${v.dish_name ?? "—"}`,
      monto: Number(v.total),
    });
  }
  for (const c of cobros ?? []) {
    const ts = c.created_at ?? "";
    items.push({ ts, fecha: ts.slice(0, 10), tipo: "abono", concepto: "Cobro", monto: Number(c.amount) });
  }
  items.sort((a, b) => (a.ts < b.ts ? 1 : -1));

  return { name: saldo?.name ?? "", saldo: Number(saldo?.saldo ?? 0), items };
}

"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth/session";
import { businessDate } from "@/lib/shifts";
import { logActivity } from "@/lib/activity";

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

/** Una línea de gasto: en qué se gastó y cuánto. */
export interface GastoLinea {
  name: string;
  amount: number;
}

/** De dónde salió el dinero del gasto. */
export type FuentePago = "caja" | "jefa";

export interface GastoResult {
  error?: string;
  ok?: boolean;
  total?: number;
  count?: number;
}

/**
 * Registra uno o varios gastos del turno reusando el RPC `registrar_gasto` —el
 * mismo que ejecuta la IA por voz— para que ambos caminos tengan idéntica lógica.
 * Cada gasto es un costo del día con `paid_from_cash = true`. La fuente decide
 * qué pasa con la caja del turno (ver v_caja_turno):
 *   - "caja": el dinero salió de la caja → baja la caja esperada por el monto.
 *   - "jefa": la jefa puso la plata → además entra un ingreso de caja por el mismo
 *     monto, así el neto en la caja es 0 pero el costo igual queda registrado.
 * Va todo como categoría "otro"; el texto escrito es la nota del gasto.
 */
export async function registrarGastos(
  lineas: GastoLinea[],
  fuente: FuentePago,
): Promise<GastoResult> {
  const session = await getSession();
  if (!session) return { error: "Sesión expirada. Vuelve a entrar." };

  if (fuente !== "caja" && fuente !== "jefa")
    return { error: "Indica de dónde salió el dinero." };

  const items = (lineas ?? [])
    .map((l) => ({ name: (l?.name ?? "").trim(), amount: Number(l?.amount) }))
    .filter((l) => l.name && l.amount > 0);
  if (items.length === 0)
    return { error: "Escribe en qué gastaste y cuánto, al menos un gasto." };

  const db = createAdminClient();
  let total = 0;

  for (const it of items) {
    const { data, error } = await db.rpc("registrar_gasto", {
      p_restaurant: session.restaurant_id,
      p_session: session.shift_session_id,
      p_user: session.user_id,
      p_date: businessDate(),
      p_amount: it.amount,
      p_category: "otro",
      p_note: it.name,
      p_fuente: fuente,
    });
    if (error) return { error: error.message };
    total += it.amount;

    await logActivity(db, {
      restaurantId: session.restaurant_id,
      userId: session.user_id,
      actorName: session.user_name,
      shiftSessionId: session.shift_session_id,
      source: "manual",
      event: "gasto",
      description: `Gasto de ${money(it.amount)} — ${it.name} — pagó ${
        fuente === "jefa" ? "la jefa" : "la caja"
      }`,
      metadata: { amount: it.amount, category: "otro", note: it.name, fuente },
      opId: (data as { op_id?: string } | null)?.op_id ?? null,
    });
  }

  revalidatePath(`/${session.slug}/hoy`);
  return { ok: true, total, count: items.length };
}

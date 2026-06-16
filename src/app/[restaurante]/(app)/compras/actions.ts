"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth/session";
import { businessDate } from "@/lib/shifts";
import { logActivity } from "@/lib/activity";

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

export interface CompraResult {
  error?: string;
  ok?: boolean;
}

/**
 * Registra la compra de un producto que YA existe en el inventario. Sube su
 * stock (costo promedio ponderado) y mueve la caja del turno: si lo pagó la
 * caja, sale (egreso); si lo puso la jefa, entra un aporte y sale el egreso
 * (neto cero). No crea, edita ni borra productos — eso es solo del admin.
 * Reversible por op_id en «Anular».
 */
export async function registrarCompra(input: {
  ingredientId: string;
  name: string;
  qty: number;
  totalCost: number;
  fuente: "caja" | "jefa";
}): Promise<CompraResult> {
  const session = await getSession();
  if (!session) return { error: "Sesión expirada. Vuelve a entrar." };
  if (!input.ingredientId) return { error: "Elige un producto." };
  if (!(input.qty > 0)) return { error: "Indica cuánto compraste." };
  if (!(input.totalCost >= 0)) return { error: "Indica cuánto pagaste." };

  const db = createAdminClient();
  const fuente = input.fuente === "jefa" ? "jefa" : "caja";
  const { data, error } = await db.rpc("registrar_compra", {
    p_restaurant: session.restaurant_id,
    p_session: session.shift_session_id,
    p_user: session.user_id,
    p_date: businessDate(),
    p_ingredient_id: input.ingredientId,
    p_name: input.name,
    p_total_cost: input.totalCost,
    p_quantity: input.qty,
    p_fuente: fuente,
  });
  if (error) return { error: error.message };

  const opId = (data as { op_id?: string } | null)?.op_id ?? null;
  await logActivity(db, {
    restaurantId: session.restaurant_id,
    userId: session.user_id,
    actorName: session.user_name,
    shiftSessionId: session.shift_session_id,
    source: "manual",
    event: "compra",
    description: `Compra: ${input.qty} ${input.name} por ${money(input.totalCost)} — pagó ${
      fuente === "jefa" ? "la jefa" : "la caja"
    }`,
    metadata: {
      ingredient: input.name,
      qty: input.qty,
      total_cost: input.totalCost,
      fuente,
    },
    opId,
  });

  revalidatePath(`/${session.slug}/compras`);
  revalidatePath(`/${session.slug}/hoy`);
  return { ok: true };
}

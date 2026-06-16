"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth/session";
import { businessDate } from "@/lib/shifts";
import { logActivity } from "@/lib/activity";
import type { Json } from "@/lib/supabase/database.types";

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

/** Un insumo gastado hoy para cocinar (cantidad en su unidad). */
export interface ConsumoLinea {
  ingredientId: string;
  name: string;
  qty: number;
}

export interface ConsumoResult {
  error?: string;
  ok?: boolean;
  total?: number;
  count?: number;
}

/**
 * Registra lo que la cocinera gastó hoy. El costo lo hereda del inventario
 * (qty × costo por unidad) y va al costo del día; si el insumo es contable,
 * además baja su stock. No incluye lo que ya se descuenta por venta.
 */
export async function registrarConsumo(lineas: ConsumoLinea[]): Promise<ConsumoResult> {
  const session = await getSession();
  if (!session) return { error: "Sesión expirada. Vuelve a entrar." };

  const items = (lineas ?? []).filter((l) => l && l.ingredientId && l.qty > 0);
  if (items.length === 0) return { error: "Pon la cantidad de al menos un insumo." };

  const db = createAdminClient();
  const { data, error } = await db.rpc("registrar_consumo", {
    p_restaurant: session.restaurant_id,
    p_session: session.shift_session_id,
    p_user: session.user_id,
    p_date: businessDate(),
    p_items: items.map((i) => ({ ingredient_id: i.ingredientId, qty: i.qty })) as unknown as Json,
  });
  if (error) return { error: error.message };

  const d = data as { total?: number; count?: number } | null;
  const total = Number(d?.total ?? 0);
  const desc = items.map((i) => `${i.qty} ${i.name}`).join(", ");
  await logActivity(db, {
    restaurantId: session.restaurant_id,
    userId: session.user_id,
    actorName: session.user_name,
    shiftSessionId: session.shift_session_id,
    source: "manual",
    event: "consumo",
    description: `Consumo del día: ${desc} (${money(total)})`,
    metadata: { items: items.length, total },
  });

  revalidatePath(`/${session.slug}/hoy`);
  return { ok: true, total, count: Number(d?.count ?? items.length) };
}

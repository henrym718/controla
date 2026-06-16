"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth/session";
import { businessDate } from "@/lib/shifts";
import { logActivity } from "@/lib/activity";
import type { Database } from "@/lib/supabase/database.types";

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

/** Una línea del carrito: un plato del menú o un producto vendible del inventario. */
export interface VentaLinea {
  kind: "plato" | "producto";
  id: string;
  name: string;
  unitPrice: number;
  qty: number;
}

export interface VentaResult {
  error?: string;
  ok?: boolean;
  total?: number;
  count?: number;
}

/**
 * Registra el carrito de venta. Cada línea se guarda como su propia venta
 * (reusa el RPC registrar_venta: descuenta inventario, estampa op_id reversible
 * y deja audit_log). Todo va en EFECTIVO y SERVIR — el envase para llevar se
 * cobra como un adicional aparte (que descuenta su propio insumo).
 */
export async function registrarVenta(lineas: VentaLinea[]): Promise<VentaResult> {
  const session = await getSession();
  if (!session) return { error: "Sesión expirada. Vuelve a entrar." };

  const items = (lineas ?? []).filter(
    (l) => l && l.id && l.qty > 0 && l.unitPrice >= 0,
  );
  if (items.length === 0) return { error: "Agrega al menos un plato antes de registrar." };

  const db = createAdminClient();
  let total = 0;

  for (const it of items) {
    const { data, error } = await db.rpc("registrar_venta", {
      p_restaurant: session.restaurant_id,
      p_session: session.shift_session_id,
      p_user: session.user_id,
      p_date: businessDate(),
      p_item_kind: it.kind,
      p_dish_id: it.kind === "plato" ? it.id : null,
      p_ingredient_id: it.kind === "producto" ? it.id : null,
      p_name: it.name,
      p_qty: it.qty,
      p_unit_price: it.unitPrice,
      p_service_type: "servir",
      p_payment_method: "efectivo",
      p_packaging_id: null,
    } as unknown as Database["public"]["Functions"]["registrar_venta"]["Args"]);
    if (error) return { error: error.message };

    const d = data as { total?: number; op_id?: string } | null;
    const lineTotal = Number(d?.total ?? it.unitPrice * it.qty);
    total += lineTotal;

    await logActivity(db, {
      restaurantId: session.restaurant_id,
      userId: session.user_id,
      actorName: session.user_name,
      shiftSessionId: session.shift_session_id,
      source: "manual",
      event: "venta",
      description: `Venta: ${it.qty} × ${it.name} = ${money(lineTotal)} (efectivo)`,
      metadata: {
        item: it.name,
        qty: it.qty,
        total: lineTotal,
        payment_method: "efectivo",
        item_kind: it.kind,
      },
      opId: d?.op_id ?? null,
    });
  }

  revalidatePath(`/${session.slug}/hoy`);
  return { ok: true, total, count: items.length };
}

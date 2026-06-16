import type { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;

/**
 * Id del turno "Todo el día" del restaurante (siempre existe tras la migración
 * 0006). El menú puesto en ese turno se hereda a TODOS los turnos del día.
 * Devuelve null si la columna/turno aún no existe (la app sigue funcionando
 * como antes, sin herencia).
 */
export async function allDayShiftId(
  db: Db,
  restaurantId: string,
): Promise<string | null> {
  const { data } = await db
    .from("shifts")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("is_all_day", true)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Turnos a consultar para el menú EFECTIVO de un turno: el propio + el de
 * "Todo el día". Si el turno actual ES el de todo-el-día (o no existe), devuelve
 * solo el propio.
 */
export async function menuShiftIds(
  db: Db,
  restaurantId: string,
  shiftId: string,
): Promise<string[]> {
  const allDay = await allDayShiftId(db, restaurantId);
  return allDay && allDay !== shiftId ? [shiftId, allDay] : [shiftId];
}

/**
 * Deduplica filas de daily_menu (de varios turnos) por dish_id. El turno
 * específico GANA sobre "Todo el día" cuando un plato está en ambos.
 */
export function dedupeMenu<T extends { dish_id: string; shift_id: string }>(
  rows: T[],
  shiftId: string,
): T[] {
  const map = new Map<string, T>();
  for (const r of rows) {
    const cur = map.get(r.dish_id);
    if (!cur || (cur.shift_id !== shiftId && r.shift_id === shiftId)) {
      map.set(r.dish_id, r);
    }
  }
  return [...map.values()];
}

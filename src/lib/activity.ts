/**
 * Bitácora de actividad: registra TODA acción que afecta al negocio
 * (quién, qué, cuándo, impacto). Las acciones de solo lectura NO se registran.
 *
 * El log es secundario: nunca debe tumbar la acción principal, por eso este
 * helper jamás lanza. Se guarda el NOMBRE de quien actuó (snapshot), no el PIN.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";

export type Db = SupabaseClient<Database>;

/** De dónde vino la acción: la IA, una acción manual de la app, o el sistema. */
export type ActivitySource = "ia" | "manual" | "sistema";

/** Códigos de evento (deben existir en la tabla activity_events). */
export type EventCode =
  | "login"
  | "logout"
  | "cambio_turno"
  | "venta"
  | "caja_inicial"
  | "ingreso_caja"
  | "egreso_caja"
  | "gasto"
  | "compra"
  | "produccion"
  | "procesar"
  | "consumo"
  | "retiro_insumo"
  | "merma"
  | "ajuste_inventario"
  | "conteo"
  | "producto_nuevo"
  | "menu"
  | "agotado"
  | "receta"
  | "cerrar_turno"
  | "cerrar_dia"
  | "usuario"
  | "turno_config"
  | "plato_config"
  | "costo_fijo";

export interface LogInput {
  restaurantId: string;
  userId?: string | null;
  actorName?: string | null;
  shiftSessionId?: string | null;
  source: ActivitySource;
  event: EventCode;
  description: string;
  metadata?: Record<string, unknown> | null;
}

/** Registra un evento en la bitácora. Silencioso ante errores (log secundario). */
export async function logActivity(db: Db, input: LogInput): Promise<void> {
  try {
    await db.from("activity_log").insert({
      restaurant_id: input.restaurantId,
      user_id: input.userId ?? null,
      actor_name: input.actorName ?? null,
      shift_session_id: input.shiftSessionId ?? null,
      source: input.source,
      event_code: input.event,
      description: input.description,
      metadata: (input.metadata ?? null) as Json,
    });
  } catch {
    // La bitácora nunca debe romper la operación real.
  }
}

"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { setSession, clearSession, getSession } from "@/lib/auth/session";
import { isShiftOpenNow, businessDate } from "@/lib/shifts";
import { clientIp, minutesLeft } from "@/lib/throttle";
import { computeDayReport } from "@/lib/reports";
import { logActivity } from "@/lib/activity";
import type { Json } from "@/lib/supabase/database.types";

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

export interface LoginResult {
  error?: string;
}

export async function loginAction(
  slug: string,
  shiftId: string,
  pin: string,
  openingCash: number | null,
): Promise<LoginResult> {
  const db = createAdminClient();

  const { data: rest } = await db
    .from("restaurants")
    .select("id,slug")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();
  if (!rest) return { error: "Restaurante no encontrado." };

  const { data: shift } = await db
    .from("shifts")
    .select("id,name,start_time,end_time")
    .eq("id", shiftId)
    .eq("restaurant_id", rest.id)
    .maybeSingle();
  if (!shift) return { error: "Turno inválido." };

  // Bloqueo anti fuerza bruta (server-side, por restaurante + IP).
  const throttleKey = `${slug}:${await clientIp()}`;
  const { data: blockedUntil } = await db.rpc("auth_estado", { p_key: throttleKey });
  if (blockedUntil) {
    return { error: `Demasiados intentos. Espera ${minutesLeft(blockedUntil)} min.` };
  }

  const { data: users, error: pinErr } = await db.rpc("login_pin", {
    p_restaurant: rest.id,
    p_pin: pin,
  });
  if (pinErr) return { error: "Error validando el PIN." };
  const user = users?.[0];
  if (!user) {
    const { data: until } = await db.rpc("auth_intento", { p_key: throttleKey, p_ok: false });
    if (until) return { error: `Demasiados intentos. Espera ${minutesLeft(until)} min.` };
    return { error: "PIN incorrecto." };
  }
  await db.rpc("auth_intento", { p_key: throttleKey, p_ok: true });

  // El admin no tiene horario; el empleado usa su horario (propio o el del turno).
  if (user.role !== "admin") {
    const { data: urow } = await db
      .from("users")
      .select("schedule_start,schedule_end")
      .eq("id", user.id)
      .maybeSingle();
    const start = urow?.schedule_start ?? shift.start_time;
    const end = urow?.schedule_end ?? shift.end_time;
    if (!isShiftOpenNow(start, end)) {
      return {
        error: `Fuera de tu horario (${start.slice(0, 5)}–${end.slice(0, 5)}).`,
      };
    }
  }

  const bd = businessDate();
  const { data: existing } = await db
    .from("shift_sessions")
    .select("id")
    .eq("restaurant_id", rest.id)
    .eq("shift_id", shift.id)
    .eq("business_date", bd)
    .eq("status", "open")
    .maybeSingle();

  let sessionId = existing?.id;
  const abrioTurno = !sessionId; // abrió el turno (no se unió a uno ya abierto)
  let cajaActualizada = false; // se reingresó con un monto >0 que corrigió la caja
  if (!sessionId) {
    // Abrir un turno NUEVO exige declarar la caja explícitamente (aunque sea 0).
    if (openingCash == null) {
      return { error: "Escribe la caja inicial del turno (puede ser 0)." };
    }
    const { data: created, error: createErr } = await db
      .from("shift_sessions")
      .insert({
        restaurant_id: rest.id,
        shift_id: shift.id,
        business_date: bd,
        responsible_user_id: user.id,
        opened_by: user.id,
        opening_cash: openingCash,
      })
      .select("id")
      .single();
    if (createErr || !created) return { error: "No se pudo abrir el turno." };
    sessionId = created.id;
  } else if (openingCash != null && openingCash > 0) {
    // Reingreso a un turno ya abierto: un monto >0 CORRIGE la caja inicial
    // (0 o vacío no la tocan). Solo antes de bloquear el conteo (anti-robo).
    const { data: upd } = await db
      .from("shift_sessions")
      .update({ opening_cash: openingCash })
      .eq("id", sessionId)
      .eq("status", "open")
      .is("counted_at", null)
      .select("id")
      .maybeSingle();
    cajaActualizada = !!upd;
  }

  await db
    .from("shift_session_members")
    .upsert({ shift_session_id: sessionId, user_id: user.id });

  await setSession({
    restaurant_id: rest.id,
    slug: rest.slug,
    user_id: user.id,
    user_name: user.name,
    user_role: user.role === "admin" ? "admin" : "empleado",
    shift_id: shift.id,
    shift_session_id: sessionId,
  });

  await logActivity(db, {
    restaurantId: rest.id,
    userId: user.id,
    actorName: user.name,
    shiftSessionId: sessionId,
    source: "manual",
    event: "login",
    description: abrioTurno
      ? `${user.name} abrió el turno ${shift.name}${openingCash != null ? ` (caja inicial ${money(openingCash)})` : ""}`
      : cajaActualizada
        ? `${user.name} entró al turno ${shift.name} y corrigió la caja inicial a ${money(openingCash!)}`
        : `${user.name} entró al turno ${shift.name}`,
    metadata: { shift: shift.name, abrio: abrioTurno, caja_actualizada: cajaActualizada },
  });

  redirect(`/${slug}/hoy`);
}

export async function logoutAction(): Promise<void> {
  const session = await getSession();
  if (session) {
    await logActivity(createAdminClient(), {
      restaurantId: session.restaurant_id,
      userId: session.user_id,
      actorName: session.user_name,
      shiftSessionId: session.shift_session_id,
      source: "manual",
      event: "logout",
      description: `${session.user_name} cerró sesión`,
    });
  }
  await clearSession();
  redirect(`/${session?.slug ?? ""}`);
}

/** Cambia al usuario a OTRO turno (corrige un turno mal elegido al ingresar). */
export async function cambiarTurnoAction(
  newShiftId: string,
  openingCash: number | null,
): Promise<LoginResult> {
  const session = await getSession();
  if (!session) return { error: "Sesión no encontrada." };
  const db = createAdminClient();

  if (newShiftId === session.shift_id) return { error: "Ya estás en ese turno." };

  const { data: shift } = await db
    .from("shifts")
    .select("id,name,start_time,end_time")
    .eq("id", newShiftId)
    .eq("restaurant_id", session.restaurant_id)
    .maybeSingle();
  if (!shift) return { error: "Turno inválido." };

  // El empleado debe estar dentro del horario del nuevo turno (el admin no).
  if (session.user_role !== "admin") {
    const { data: urow } = await db
      .from("users")
      .select("schedule_start,schedule_end")
      .eq("id", session.user_id)
      .maybeSingle();
    const start = urow?.schedule_start ?? shift.start_time;
    const end = urow?.schedule_end ?? shift.end_time;
    if (!isShiftOpenNow(start, end)) {
      return { error: `Fuera de tu horario (${start.slice(0, 5)}–${end.slice(0, 5)}).` };
    }
  }

  // Salir del turno anterior y borrarlo si quedó vacío (fue un error de apertura).
  const oldId = session.shift_session_id;
  await db
    .from("shift_session_members")
    .delete()
    .eq("shift_session_id", oldId)
    .eq("user_id", session.user_id);
  await borrarTurnoSiVacio(db, oldId, session.user_id);

  // Abrir o unirse al nuevo turno.
  const bd = businessDate();
  const { data: existing } = await db
    .from("shift_sessions")
    .select("id")
    .eq("restaurant_id", session.restaurant_id)
    .eq("shift_id", shift.id)
    .eq("business_date", bd)
    .eq("status", "open")
    .maybeSingle();

  let sessionId = existing?.id;
  let cajaActualizada = false;
  if (!sessionId) {
    if (openingCash == null) {
      return { error: "Escribe la caja inicial del turno (puede ser 0)." };
    }
    const { data: created, error: e } = await db
      .from("shift_sessions")
      .insert({
        restaurant_id: session.restaurant_id,
        shift_id: shift.id,
        business_date: bd,
        responsible_user_id: session.user_id,
        opened_by: session.user_id,
        opening_cash: openingCash,
      })
      .select("id")
      .single();
    if (e || !created) return { error: "No se pudo abrir el turno." };
    sessionId = created.id;
  } else if (openingCash != null && openingCash > 0) {
    // Turno ya abierto: un monto >0 corrige la caja inicial (0/vacío no la toca).
    // Solo antes de bloquear el conteo (anti-robo).
    const { data: upd } = await db
      .from("shift_sessions")
      .update({ opening_cash: openingCash })
      .eq("id", sessionId)
      .eq("status", "open")
      .is("counted_at", null)
      .select("id")
      .maybeSingle();
    cajaActualizada = !!upd;
  }
  await db
    .from("shift_session_members")
    .upsert({ shift_session_id: sessionId, user_id: session.user_id });

  await setSession({
    restaurant_id: session.restaurant_id,
    slug: session.slug,
    user_id: session.user_id,
    user_name: session.user_name,
    user_role: session.user_role,
    shift_id: shift.id,
    shift_session_id: sessionId,
  });

  await logActivity(db, {
    restaurantId: session.restaurant_id,
    userId: session.user_id,
    actorName: session.user_name,
    shiftSessionId: sessionId,
    source: "manual",
    event: "cambio_turno",
    description: cajaActualizada
      ? `${session.user_name} cambió al turno ${shift.name} y corrigió la caja inicial a ${money(openingCash!)}`
      : `${session.user_name} cambió al turno ${shift.name}`,
    metadata: { shift: shift.name, caja_actualizada: cajaActualizada },
  });

  redirect(`/${session.slug}/hoy`);
}

/** Borra un turno SOLO si quedó sin miembros y sin actividad (apertura por error). */
async function borrarTurnoSiVacio(
  db: ReturnType<typeof createAdminClient>,
  sessionId: string,
  userId: string,
) {
  const { count: members } = await db
    .from("shift_session_members")
    .select("user_id", { count: "exact", head: true })
    .eq("shift_session_id", sessionId);
  if ((members ?? 0) > 0) return; // otras personas siguen en el turno

  const checks = await Promise.all([
    db.from("sales").select("id", { count: "exact", head: true }).eq("shift_session_id", sessionId),
    db.from("cash_movements").select("id", { count: "exact", head: true }).eq("shift_session_id", sessionId),
    db.from("expenses").select("id", { count: "exact", head: true }).eq("shift_session_id", sessionId),
    db.from("inventory_movements").select("id", { count: "exact", head: true }).eq("shift_session_id", sessionId),
    db.from("production_batches").select("id", { count: "exact", head: true }).eq("shift_session_id", sessionId),
    db.from("audit_log").select("id", { count: "exact", head: true }).eq("shift_session_id", sessionId),
  ]);
  if (checks.some((c) => (c.count ?? 0) > 0)) return; // tiene movimientos → no se borra

  const { data: ss } = await db
    .from("shift_sessions")
    .select("opened_by,status")
    .eq("id", sessionId)
    .maybeSingle();
  if (ss?.status === "open" && ss?.opened_by === userId) {
    await db.from("shift_sessions").delete().eq("id", sessionId);
  }
}

export async function cerrarTurnoAction(
  countedCash: number,
  closingFloat: number,
  notes?: string,
): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/");

  const db = createAdminClient();
  const { data, error } = await db.rpc("cerrar_turno", {
    p_session_id: session.shift_session_id,
    p_counted_cash: countedCash,
    p_closing_float: closingFloat,
    p_closed_by: session.user_id,
    p_notes: notes ?? "",
  });
  await clearSession();

  if (error) {
    redirect(`/${session.slug}?cerrado=error`);
  }
  const exp = Number(data?.expected_cash ?? 0);
  const dif = Number(data?.cash_discrepancy ?? 0);
  const fl = Number(data?.closing_float ?? 0);
  const dep = Number(data?.deposit_amount ?? 0);

  await logActivity(db, {
    restaurantId: session.restaurant_id,
    userId: session.user_id,
    actorName: session.user_name,
    shiftSessionId: session.shift_session_id,
    source: "manual",
    event: "cerrar_turno",
    description: `${session.user_name} cerró el turno. Esperado ${money(exp)}, contado ${money(countedCash)}, descuadre ${money(dif)}`,
    metadata: { expected: exp, counted: countedCash, discrepancy: dif, deposit: dep },
  });

  redirect(
    `/${session.slug}/turno-cerrado?exp=${exp}&cnt=${countedCash}&dif=${dif}&fl=${fl}&dep=${dep}`,
  );
}

/**
 * Registra y BLOQUEA el efectivo contado ANTES de revelar lo esperado (anti-robo).
 * Idempotente: si ya estaba bloqueado, no vuelve a tocar nada ni re-registra en
 * bitácora; solo lleva a la pantalla de cuadre. Una vez fijado, la encargada no
 * puede cambiarlo (solo la jefa lo reabre con reabrirConteoAction).
 */
export async function registrarConteoAction(countedCash: number): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/");

  const db = createAdminClient();

  // ¿Ya estaba bloqueado? (volver atrás / reenvío) → no re-registrar, solo seguir.
  const { data: ss } = await db
    .from("shift_sessions")
    .select("counted_at")
    .eq("id", session.shift_session_id)
    .maybeSingle();
  if (ss?.counted_at) redirect(`/${session.slug}/cierre-turno`);

  const { error } = await db.rpc("registrar_conteo_caja", {
    p_session_id: session.shift_session_id,
    p_counted_cash: countedCash,
    p_user: session.user_id,
  });
  if (error) redirect(`/${session.slug}/cierre-turno?e=1`);

  await logActivity(db, {
    restaurantId: session.restaurant_id,
    userId: session.user_id,
    actorName: session.user_name,
    shiftSessionId: session.shift_session_id,
    source: "manual",
    event: "conteo_caja",
    description: `${session.user_name} registró y bloqueó el conteo de caja: ${money(countedCash)}`,
    metadata: { counted: countedCash },
  });

  redirect(`/${session.slug}/cierre-turno`);
}

/** SOLO la jefa: reabre (borra) el conteo bloqueado de un turno abierto para
 *  corregir un error de digitación. Devuelve {error} si no se pudo. */
export async function reabrirConteoAction(
  sessionId: string,
): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session) return { error: "Sesión no encontrada." };
  if (session.user_role !== "admin")
    return { error: "Solo la jefa puede reabrir el conteo." };

  const db = createAdminClient();

  // El turno debe ser de este restaurante (defensa) y seguir abierto.
  const { data: ss } = await db
    .from("shift_sessions")
    .select("restaurant_id,status")
    .eq("id", sessionId)
    .maybeSingle();
  if (!ss || ss.restaurant_id !== session.restaurant_id)
    return { error: "Turno no encontrado." };
  if (ss.status !== "open")
    return { error: "El turno ya se cerró; no se puede reabrir el conteo." };

  const { error } = await db.rpc("reabrir_conteo_caja", {
    p_session_id: sessionId,
    p_admin: session.user_id,
  });
  if (error) return { error: "No se pudo reabrir el conteo." };

  await logActivity(db, {
    restaurantId: session.restaurant_id,
    userId: session.user_id,
    actorName: session.user_name,
    shiftSessionId: sessionId,
    source: "manual",
    event: "reabrir_conteo",
    description: `${session.user_name} reabrió el conteo de caja del turno (corrección)`,
    metadata: { session_id: sessionId },
  });

  return {};
}

/** Cierre diario: aplica la merma % del granel y prorratea (RPC cerrar_dia). */
export async function cerrarDiaAction(
  merma: Record<string, number>,
): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session) redirect("/");

  const db = createAdminClient();
  const date = businessDate();

  // No cerrar un día que nadie abrió (sin turno = sin actividad).
  const { count: nSesiones } = await db
    .from("shift_sessions")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", session.restaurant_id)
    .eq("business_date", date);
  if (!nSesiones) {
    return { error: "Nadie abrió turno este día; no hay nada que cerrar." };
  }

  await db.rpc("cerrar_dia", {
    p_restaurant: session.restaurant_id,
    p_date: date,
    p_merma: merma as unknown as Json,
    p_closed_by: session.user_id,
  });

  await logActivity(db, {
    restaurantId: session.restaurant_id,
    userId: session.user_id,
    actorName: session.user_name,
    shiftSessionId: session.shift_session_id,
    source: "manual",
    event: "cerrar_dia",
    description: `${session.user_name} cerró el día (${date})`,
    metadata: { date },
  });

  // Guardar el costo real (prorrateado) de cada plato del día → historial.
  const report = await computeDayReport(db, session.restaurant_id, date);
  for (const d of report.dishes) {
    if (d.dishId && d.unitCost != null) {
      await db.from("dish_daily_cost").upsert(
        {
          restaurant_id: session.restaurant_id,
          dish_id: d.dishId,
          business_date: date,
          unit_cost: d.unitCost,
          price: d.qty > 0 ? d.revenue / d.qty : 0,
          qty: d.qty,
        },
        { onConflict: "restaurant_id,dish_id,business_date" },
      );
    }
  }

  return {};
}

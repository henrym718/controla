"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { setSession, clearSession, getSession } from "@/lib/auth/session";
import { isShiftOpenNow, businessDate } from "@/lib/shifts";
import { computeDayReport } from "@/lib/reports";
import type { Json } from "@/lib/supabase/database.types";

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

  const { data: users, error: pinErr } = await db.rpc("login_pin", {
    p_restaurant: rest.id,
    p_pin: pin,
  });
  if (pinErr) return { error: "Error validando el PIN." };
  const user = users?.[0];
  if (!user) return { error: "PIN incorrecto." };

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

  redirect(`/${slug}/hoy`);
}

export async function logoutAction(): Promise<void> {
  const session = await getSession();
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
  redirect(
    `/${session.slug}/turno-cerrado?exp=${exp}&cnt=${countedCash}&dif=${dif}&fl=${fl}&dep=${dep}`,
  );
}

/** Cierre diario: aplica la merma % del granel y prorratea (RPC cerrar_dia). */
export async function cerrarDiaAction(
  merma: Record<string, number>,
): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/");

  const db = createAdminClient();
  const date = businessDate();
  await db.rpc("cerrar_dia", {
    p_restaurant: session.restaurant_id,
    p_date: date,
    p_merma: merma as unknown as Json,
    p_closed_by: session.user_id,
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

  redirect(`/${session.slug}/resumen`);
}

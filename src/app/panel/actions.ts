"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSuper, setSuper, clearSuper } from "@/lib/auth/session";
import { clientIp, minutesLeft } from "@/lib/throttle";

export interface PanelResult {
  error?: string;
  ok?: boolean;
}

async function requireSuper() {
  if (!(await getSuper())) throw new Error("No autorizado");
  return createAdminClient();
}

export async function superLoginAction(pin: string): Promise<PanelResult> {
  const db = createAdminClient();
  const key = `super:${await clientIp()}`;

  const { data: blocked } = await db.rpc("auth_estado", { p_key: key });
  if (blocked) return { error: `Demasiados intentos. Espera ${minutesLeft(blocked)} min.` };

  // PIN del panel: registrado en la base por el pipeline. Fallback por env (local).
  const { data: dbOk } = await db.rpc("verify_super_pin", { p_pin: pin });
  const envPin = process.env.SUPER_ADMIN_PIN;
  const ok = dbOk === true || (!!envPin && pin === envPin);
  if (!ok) {
    const { data: until } = await db.rpc("auth_intento", { p_key: key, p_ok: false });
    if (until) return { error: `Demasiados intentos. Espera ${minutesLeft(until)} min.` };
    return { error: "PIN incorrecto." };
  }
  await db.rpc("auth_intento", { p_key: key, p_ok: true });
  await setSuper();
  redirect("/panel");
}

export async function superLogoutAction(): Promise<void> {
  await clearSuper();
  redirect("/panel/login");
}

export async function crearRestauranteAction(input: {
  name: string;
  slug: string;
  adminName: string;
  adminPin: string;
}): Promise<PanelResult> {
  const db = await requireSuper();
  if (!input.name.trim() || !input.slug.trim() || !input.adminName.trim()) {
    return { error: "Completa nombre, enlace y nombre del admin." };
  }
  if (!/^\d{4,6}$/.test(input.adminPin)) {
    return { error: "El PIN del admin debe tener de 4 a 6 dígitos." };
  }
  const { error } = await db.rpc("crear_restaurante", {
    p_slug: input.slug.trim().toLowerCase(),
    p_name: input.name.trim(),
    p_admin_name: input.adminName.trim(),
    p_admin_pin: input.adminPin,
  });
  if (error) return { error: error.message };
  revalidatePath("/panel");
  return { ok: true };
}

export async function crearUsuarioPanelAction(input: {
  restaurantId: string;
  name: string;
  role: string;
  pin: string;
}): Promise<PanelResult> {
  const db = await requireSuper();
  if (!input.name.trim()) return { error: "Escribe el nombre." };
  if (!/^\d{4,6}$/.test(input.pin)) return { error: "El PIN debe tener de 4 a 6 dígitos." };
  const { error } = await db.rpc("admin_create_user", {
    p_restaurant: input.restaurantId,
    p_name: input.name.trim(),
    p_role: input.role === "admin" ? "admin" : "empleado",
    p_pin: input.pin,
  });
  if (error) return { error: error.message };
  revalidatePath("/panel");
  return { ok: true };
}

export async function toggleRestauranteAction(
  id: string,
  active: boolean,
): Promise<PanelResult> {
  const db = await requireSuper();
  await db.from("restaurants").update({ active }).eq("id", id);
  revalidatePath("/panel");
  return { ok: true };
}

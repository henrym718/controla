"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth/session";

export interface ClienteResult {
  error?: string;
  ok?: boolean;
  id?: string;
  name?: string;
}

/**
 * Crea una persona que puede comprar a crédito. Lo usa el admin (módulo Clientes)
 * y también las cajeras al vender a crédito (crear en el momento). Por eso NO está
 * restringido a admin: cualquier sesión válida puede registrar a alguien.
 */
export async function crearCliente(input: {
  name: string;
  kind: "cliente" | "empleado";
}): Promise<ClienteResult> {
  const session = await getSession();
  if (!session) return { error: "Sesión expirada. Vuelve a entrar." };
  const name = input.name.trim();
  if (!name) return { error: "Escribe el nombre." };
  const kind = input.kind === "empleado" ? "empleado" : "cliente";

  const db = createAdminClient();
  const { data, error } = await db
    .from("clientes")
    .insert({
      restaurant_id: session.restaurant_id,
      name,
      kind,
      created_by: session.user_id,
    })
    .select("id,name")
    .single();
  if (error) {
    if (error.code === "23505") return { error: "Ya hay alguien con ese nombre." };
    return { error: error.message };
  }

  revalidatePath(`/${session.slug}/clientes`);
  return { ok: true, id: data?.id, name: data?.name };
}

/** Activa/desactiva un cliente (solo admin). Inactivo = ya no sale para vender. */
export async function toggleCliente(id: string, active: boolean): Promise<ClienteResult> {
  const session = await getSession();
  if (!session || session.user_role !== "admin") return { error: "No autorizado." };
  const db = createAdminClient();
  const { error } = await db
    .from("clientes")
    .update({ active })
    .eq("id", id)
    .eq("restaurant_id", session.restaurant_id);
  if (error) return { error: error.message };
  revalidatePath(`/${session.slug}/clientes`);
  return { ok: true };
}

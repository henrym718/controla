import "server-only";
import { headers } from "next/headers";

/** IP del cliente (para el bloqueo anti fuerza bruta del login). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  return xff?.split(",")[0]?.trim() || h.get("x-real-ip") || "0.0.0.0";
}

/** Minutos que faltan para desbloquear (mínimo 1). */
export function minutesLeft(until: string): number {
  return Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 60000));
}

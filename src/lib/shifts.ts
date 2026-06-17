/** Helpers de turno: ventana horaria de habilitación y fecha operativa. */

// La zona del negocio. Todo "hoy" y toda ventana de turno se miden aquí, NO en
// la hora del servidor (Vercel corre en UTC → de tarde/noche ya sería otro día).
const BUSINESS_TZ = "America/Guayaquil";

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Hora y minuto actuales en la zona del negocio (Ecuador). */
function businessHourMinute(d: Date): { h: number; m: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { h: h === 24 ? 0 : h, m };
}

/**
 * ¿El turno está dentro de su ventana ahora? (en hora de Ecuador)
 * Si end < start, el turno cruza la medianoche (turno noche).
 * DISABLE_SHIFT_WINDOW=1 lo desactiva (útil en desarrollo).
 */
export function isShiftOpenNow(
  startTime: string,
  endTime: string,
  now = new Date(),
): boolean {
  if (process.env.DISABLE_SHIFT_WINDOW === "1") return true;
  const { h, m } = businessHourMinute(now);
  const cur = h * 60 + m;
  const s = toMinutes(startTime);
  const e = toMinutes(endTime);
  return e >= s ? cur >= s && cur <= e : cur >= s || cur <= e;
}

/**
 * Fecha operativa YYYY-MM-DD EN LA ZONA DEL NEGOCIO (Ecuador), sin importar
 * dónde corra el servidor. en-CA formatea como YYYY-MM-DD.
 */
export function businessDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Hora de un instante EN LA ZONA DEL NEGOCIO (Ecuador), formato 12h limpio.
 * Ej.: "2:35 pm". Se calcula en el servidor para que la hora sea siempre la de
 * Ecuador, sin depender de la zona del navegador que la mira.
 */
export function businessTime(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(d)
    .toLowerCase();
}

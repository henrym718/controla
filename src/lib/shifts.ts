/** Helpers de turno: ventana horaria de habilitación y fecha operativa. */

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

/**
 * ¿El turno está dentro de su ventana ahora?
 * Si end < start, el turno cruza la medianoche (turno noche).
 * DISABLE_SHIFT_WINDOW=1 lo desactiva (útil en desarrollo).
 */
export function isShiftOpenNow(
  startTime: string,
  endTime: string,
  now = new Date(),
): boolean {
  if (process.env.DISABLE_SHIFT_WINDOW === "1") return true;
  const cur = now.getHours() * 60 + now.getMinutes();
  const s = toMinutes(startTime);
  const e = toMinutes(endTime);
  return e >= s ? cur >= s && cur <= e : cur >= s || cur <= e;
}

/** Fecha operativa YYYY-MM-DD (local). */
export function businessDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

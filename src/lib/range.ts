export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;
  preset: string;
  label: string;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Resuelve el rango desde los searchParams (?preset / ?from / ?to). */
export function resolveRange(sp: {
  preset?: string;
  from?: string;
  to?: string;
}): DateRange {
  const today = new Date();
  const t = ymd(today);
  const minus = (n: number) => {
    const d = new Date(today);
    d.setDate(today.getDate() - n);
    return ymd(d);
  };
  const preset = sp.preset ?? "7d";
  switch (preset) {
    case "hoy":
      return { from: t, to: t, preset, label: "Hoy" };
    case "ayer": {
      const y = minus(1);
      return { from: y, to: y, preset, label: "Ayer" };
    }
    case "30d":
      return { from: minus(29), to: t, preset, label: "Últimos 30 días" };
    case "mes":
      return {
        from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)),
        to: t,
        preset,
        label: "Este mes",
      };
    case "custom":
      return {
        from: sp.from ?? minus(6),
        to: sp.to ?? t,
        preset,
        label: "Personalizado",
      };
    default:
      return { from: minus(6), to: t, preset: "7d", label: "Últimos 7 días" };
  }
}

/** Lista de fechas (Date) entre from y to inclusive. */
export function eachDate(from: string, to: string): Date[] {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const start = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  const out: Date[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(new Date(d));
  }
  return out;
}

export function parseLocal(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

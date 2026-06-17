import Link from "next/link";
import { redirect } from "next/navigation";
import { Pencil } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDate } from "@/lib/shifts";
import { allDayShiftId } from "@/lib/menu";
import { parseLocal } from "@/lib/range";
import { PageTitle } from "@/components/ui";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function shiftYmd(date: string, delta: number): string {
  const d = parseLocal(date);
  d.setDate(d.getDate() + delta);
  return ymd(d);
}
function dateLabel(date: string, today: string): string {
  if (date === today) return "Hoy";
  const d = parseLocal(date);
  return `${d.getDate()} de ${MESES[d.getMonth()]}`;
}
const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

export default async function MenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurante: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);

  const db = createAdminClient();
  const isAdmin = session.user_role === "admin";
  const sp = await searchParams;
  const today = businessDate();
  const date = isAdmin && sp.date ? sp.date : today;

  // El menú es de TODO EL DÍA: lo leemos de ese turno (sin franjas horarias).
  const allDayId = await allDayShiftId(db, session.restaurant_id);
  const { data: menu } = await db
    .from("daily_menu")
    .select("price,available,dishes(name)")
    .eq("restaurant_id", session.restaurant_id)
    .eq("business_date", date)
    .eq("shift_id", allDayId ?? "")
    .order("sort_order");

  const items = (menu ?? [])
    .filter((m) => m.available)
    .map((m) => ({
      name: (m.dishes as unknown as { name: string } | null)?.name ?? "",
      price: Number(m.price),
    }));

  const editHref = `/${restaurante}/menu/editar?date=${date}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <PageTitle title="Menú del día" />
        <Link
          href={editHref}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white"
        >
          <Pencil className="h-4 w-4" />
          Editar
        </Link>
      </div>

      {isAdmin ? (
        <div className="flex items-center justify-center gap-2">
          <Link
            href={`/${restaurante}/menu?date=${shiftYmd(date, -1)}`}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-ink/5 text-xl font-bold"
          >
            ‹
          </Link>
          <div className="min-w-32 text-center">
            <p className="text-base font-bold leading-tight">{dateLabel(date, today)}</p>
            {date !== today && <p className="text-xs opacity-50">{date}</p>}
          </div>
          <Link
            href={`/${restaurante}/menu?date=${shiftYmd(date, 1)}`}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-ink/5 text-xl font-bold"
          >
            ›
          </Link>
        </div>
      ) : (
        <p className="text-center text-sm font-semibold opacity-60">Menú de hoy</p>
      )}

      {items.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          {items.map((it, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 rounded-2xl border border-ink/10 px-5 py-4"
            >
              <span className="text-xl font-bold leading-tight">{it.name}</span>
              <span className="shrink-0 text-xl font-bold">{money(it.price)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-3xl bg-ink/[0.03] px-6 py-12 text-center">
          <p className="text-base font-semibold">
            {date === today ? "Aún no hay menú para hoy" : "No hubo menú ese día"}
          </p>
          <Link
            href={editHref}
            className="mt-4 inline-flex rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white"
          >
            Definir menú
          </Link>
        </div>
      )}
    </div>
  );
}

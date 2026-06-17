import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDate } from "@/lib/shifts";
import { menuShiftIds, dedupeMenu } from "@/lib/menu";
import { Stat, LinkButton } from "@/components/ui";

export default async function HoyPage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);

  const db = createAdminClient();
  // El menú de hoy = lo de ESTE turno + lo de "Todo el día".
  const shiftIds = await menuShiftIds(db, session.restaurant_id, session.shift_id);
  const [{ data: caja }, { data: ventas }, { data: menu }, { data: saldos }] =
    await Promise.all([
      db
        .from("v_caja_turno")
        .select("caja_esperada,opening_cash")
        .eq("shift_session_id", session.shift_session_id)
        .maybeSingle(),
      db
        .from("sales")
        .select("total")
        .eq("shift_session_id", session.shift_session_id)
        .is("voided_at", null)
        .eq("consumo_interno", false),
      db
        .from("daily_menu")
        .select("dish_id,shift_id,price,available,dishes(name)")
        .eq("restaurant_id", session.restaurant_id)
        .eq("business_date", businessDate())
        .in("shift_id", shiftIds)
        .order("sort_order"),
      db
        .from("v_saldos_credito")
        .select("saldo")
        .eq("restaurant_id", session.restaurant_id)
        .gt("saldo", 0),
    ]);

  const totalVentas = (ventas ?? []).reduce((s, v) => s + Number(v.total), 0);
  const menuItems = dedupeMenu(menu ?? [], session.shift_id).filter((m) => m.available);
  const deudores = saldos ?? [];
  const totalPorCobrar = deudores.reduce((s, d) => s + Number(d.saldo), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Caja esperada"
          value={`$${Number(caja?.caja_esperada ?? 0).toFixed(2)}`}
          tone="lav"
          hint={`inicial $${Number(caja?.opening_cash ?? 0).toFixed(2)}`}
        />
        <Stat
          label="Ventas del turno"
          value={`$${totalVentas.toFixed(2)}`}
          tone="mint"
          hint={`${ventas?.length ?? 0} ventas`}
        />
      </div>

      <Link href={`/${restaurante}/menu`} className="rounded-3xl bg-sand p-5">
        <span className="block text-lg font-bold leading-tight">Ver menú del día</span>
        <span className="mt-0.5 block text-sm opacity-60">
          {menuItems.length
            ? `${menuItems.length} ${menuItems.length === 1 ? "plato disponible" : "platos disponibles"}`
            : "Sin definir aún · tócalo para armarlo"}
        </span>
      </Link>

      <div className="relative overflow-hidden rounded-[28px] bg-blue text-white">
        <Link href={`/${restaurante}/vender`} className="block p-6">
          <span className="blob absolute -right-6 -top-6 h-24 w-24 bg-white/20" />
          <span className="blob absolute -bottom-8 left-12 h-16 w-16 bg-white/10" />
          <span className="relative block pr-16 text-xl font-bold leading-tight">
            Registrar venta
          </span>
          <span className="relative mt-1 block pr-16 text-sm text-white/85">
            Marca los platos y cobra al toque
          </span>
        </Link>
        {/* Atajo al asistente de voz: toca el micrófono para registrar la venta
            hablando; toca cualquier otra parte de la card para la venta manual. */}
        <Link
          href={`/${restaurante}/capturar`}
          aria-label="Registrar venta por voz"
          className="absolute right-4 top-1/2 z-10 flex h-16 w-16 -translate-y-1/2 items-center justify-center rounded-full bg-paper text-ink shadow-md transition active:scale-95"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-7 w-7"
          >
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <line x1="12" y1="18" x2="12" y2="21" />
            <line x1="8" y1="21" x2="16" y2="21" />
          </svg>
        </Link>
      </div>

      <Link href={`/${restaurante}/gastos`} className="rounded-3xl bg-mint p-5">
        <span className="block text-lg font-bold leading-tight">Registrar gasto</span>
        <span className="mt-0.5 block text-sm opacity-60">
          Servicios o lo que se pagó hoy
        </span>
      </Link>

      <Link href={`/${restaurante}/consumo`} className="rounded-3xl bg-lav p-5">
        <span className="block text-lg font-bold leading-tight">Registrar consumo de cocina</span>
        <span className="mt-0.5 block text-sm opacity-60">
          Lo que usaste para cocinar
        </span>
      </Link>

      <div className="grid grid-cols-2 gap-3">
        <Link
          href={`/${restaurante}/cierre-turno`}
          className="flex min-h-24 flex-col justify-between rounded-3xl bg-peach p-4"
        >
          <span className="text-base font-bold leading-tight">Cerrar turno</span>
          <span className="text-xs opacity-60">Cuadrar la caja y entregar</span>
        </Link>
        <Link
          href={`/${restaurante}/reversar`}
          className="flex min-h-24 flex-col justify-between rounded-3xl bg-sand p-4"
        >
          <span className="text-base font-bold leading-tight">Anular algo</span>
          <span className="text-xs opacity-60">Una venta o gasto por error</span>
        </Link>
        <Link
          href={`/${restaurante}/cambiar-turno`}
          className="flex min-h-24 flex-col justify-between rounded-3xl bg-lav p-4"
        >
          <span className="text-base font-bold leading-tight">Cambiar de turno</span>
          <span className="text-xs opacity-60">¿Entraste al turno equivocado?</span>
        </Link>
        <Link
          href={`/${restaurante}/cuentas-por-cobrar`}
          className="flex min-h-24 flex-col justify-between rounded-3xl bg-mint p-4"
        >
          <span className="text-base font-bold leading-tight">Cuentas por cobrar</span>
          {totalPorCobrar > 0 ? (
            <span className="text-sm font-bold text-coral">
              ${totalPorCobrar.toFixed(2)}
              <span className="block text-xs font-normal text-ink opacity-60">
                {deudores.length} {deudores.length === 1 ? "persona debe" : "personas deben"}
              </span>
            </span>
          ) : (
            <span className="text-xs opacity-60">Ventas a crédito (fiado)</span>
          )}
        </Link>
      </div>

      {session.user_role === "admin" && (
        <LinkButton href={`/${restaurante}/admin`} variant="soft">
          Administrar el negocio
        </LinkButton>
      )}
    </div>
  );
}

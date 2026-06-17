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

      <Link
        href={`/${restaurante}/vender`}
        className="relative overflow-hidden rounded-[28px] bg-blue p-6 text-white"
      >
        <span className="blob absolute -right-6 -top-6 h-24 w-24 bg-white/20" />
        <span className="blob absolute -bottom-8 left-12 h-16 w-16 bg-white/10" />
        <span className="relative block text-xl font-bold leading-tight">
          Registrar venta
        </span>
        <span className="relative mt-1 block text-sm text-white/85">
          Marca los platos y cobra al toque
        </span>
      </Link>

      <Link href={`/${restaurante}/gastos`} className="rounded-3xl bg-mint p-5">
        <span className="block text-lg font-bold leading-tight">Registrar gasto</span>
        <span className="mt-0.5 block text-sm opacity-60">
          Servicios o lo que se pagó hoy
        </span>
      </Link>

      <Link href={`/${restaurante}/compras`} className="rounded-3xl bg-sand p-5">
        <span className="block text-lg font-bold leading-tight">Registrar inventario</span>
        <span className="mt-0.5 block text-sm opacity-60">
          Insumos que compraste hoy
        </span>
      </Link>

      <Link href={`/${restaurante}/consumo`} className="rounded-3xl bg-lav p-5">
        <span className="block text-lg font-bold leading-tight">Registrar consumo de cocina</span>
        <span className="mt-0.5 block text-sm opacity-60">
          Lo que usaste para cocinar
        </span>
      </Link>

      <Link href={`/${restaurante}/cuentas-por-cobrar`} className="rounded-3xl bg-peach p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="block text-lg font-bold leading-tight">Cuentas por cobrar</span>
            <span className="mt-0.5 block text-sm opacity-60">
              {deudores.length
                ? `${deudores.length} ${deudores.length === 1 ? "persona debe" : "personas deben"}`
                : "Ventas a crédito (fiado)"}
            </span>
          </div>
          {totalPorCobrar > 0 && (
            <span className="shrink-0 text-lg font-bold text-coral">
              ${totalPorCobrar.toFixed(2)}
            </span>
          )}
        </div>
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
      </div>

      <Link
        href={`/${restaurante}/cambiar-turno`}
        className="rounded-2xl border border-ink/15 p-3 text-center text-sm font-semibold"
      >
        Cambiar de turno
        <span className="block text-xs font-normal opacity-50">¿Entraste al turno equivocado?</span>
      </Link>

      {session.user_role === "admin" && (
        <LinkButton href={`/${restaurante}/admin`} variant="soft">
          Administrar el negocio
        </LinkButton>
      )}
    </div>
  );
}

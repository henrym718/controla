import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDate } from "@/lib/shifts";
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
  const [{ data: caja }, { data: ventas }, { data: menu }] = await Promise.all([
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
      .select("price,available,dishes(name)")
      .eq("restaurant_id", session.restaurant_id)
      .eq("business_date", businessDate())
      .eq("shift_id", session.shift_id)
      .order("sort_order"),
  ]);

  const totalVentas = (ventas ?? []).reduce((s, v) => s + Number(v.total), 0);
  const menuItems = (menu ?? []).filter((m) => m.available);

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

      <Link
        href={`/${restaurante}/vender`}
        className="relative overflow-hidden rounded-[32px] bg-coral p-8 text-white"
      >
        <span className="blob absolute -right-6 -top-6 h-28 w-28 bg-white/20" />
        <span className="blob absolute -bottom-8 left-12 h-20 w-20 bg-white/10" />
        <span className="relative block text-2xl font-bold leading-tight">
          Registrar venta
        </span>
        <span className="relative mt-1 block text-sm text-white/80">
          Marca los platos y cobra al toque
        </span>
      </Link>

      <Link href={`/${restaurante}/consumo`} className="rounded-3xl bg-lav p-5">
        <span className="block text-lg font-bold leading-tight">Registrar consumo</span>
        <span className="mt-0.5 block text-sm opacity-60">
          Lo que gastaste hoy para cocinar
        </span>
      </Link>

      <Link href={`/${restaurante}/gastos`} className="rounded-3xl bg-mint p-5">
        <span className="block text-lg font-bold leading-tight">Registrar gasto</span>
        <span className="mt-0.5 block text-sm opacity-60">
          Servicios, compras o lo que se pagó hoy
        </span>
      </Link>

      <Link
        href={`/${restaurante}/menu`}
        className="rounded-3xl border border-ink/10 p-4"
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Menú de hoy</span>
          <span className="text-xs font-semibold text-coral">
            {menuItems.length ? "Editar" : "Definir"}
          </span>
        </div>
        {menuItems.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {menuItems.map((m, i) => {
              const d = m.dishes as unknown as { name: string } | null;
              return (
                <span
                  key={i}
                  className="rounded-full bg-sand px-3 py-1 text-xs font-medium"
                >
                  {d?.name} ${Number(m.price).toFixed(2)}
                </span>
              );
            })}
          </div>
        ) : (
          <p className="mt-1 text-xs opacity-50">
            Aún no defines el menú de este turno. Tócalo o dilo por voz.
          </p>
        )}
      </Link>

      <Link
        href={`/${restaurante}/capturar`}
        className="relative overflow-hidden rounded-[32px] bg-ink p-8 text-white"
      >
        <span className="blob absolute -right-6 -top-6 h-28 w-28 bg-coral/80" />
        <span className="blob absolute -bottom-8 left-10 h-20 w-20 bg-purple/70" />
        <span className="relative block text-2xl font-bold leading-tight">
          Hablar y registrar
        </span>
        <span className="relative mt-1 block text-sm text-white/70">
          Ventas, gastos, caja… di lo que pasó
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

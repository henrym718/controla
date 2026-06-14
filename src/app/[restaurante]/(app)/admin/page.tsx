import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { PageTitle, LinkButton } from "@/components/ui";

export default async function AdminPage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);
  if (session.user_role !== "admin") redirect(`/${restaurante}/hoy`);

  const base = `/${restaurante}`;
  const items: { href: string; label: string; tone: string }[] = [
    { href: `${base}/resumen`, label: "Resumen diario", tone: "bg-lav" },
    { href: `${base}/cuadres`, label: "Cuadres de caja", tone: "bg-peach" },
    { href: `${base}/analitica`, label: "Analítica y control", tone: "bg-mint" },
    { href: `${base}/costos-fijos`, label: "Costos fijos y P&L", tone: "bg-peach" },
    { href: `${base}/historico`, label: "Histórico de platos", tone: "bg-sand" },
    { href: `${base}/catalogo`, label: "Catálogo de platos", tone: "bg-lav" },
    { href: `${base}/inventario`, label: "Inventario", tone: "bg-mint" },
    { href: `${base}/conteo`, label: "Conteo de cierre", tone: "bg-sand" },
    { href: `${base}/cierre-dia`, label: "Cerrar el día", tone: "bg-peach" },
    { href: `${base}/usuarios`, label: "Usuarios y PINs", tone: "bg-sand" },
    { href: `${base}/turnos`, label: "Turnos", tone: "bg-lav" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageTitle title="Administrar" subtitle="El control del negocio en un lugar" />
      <div className="grid grid-cols-2 gap-3">
        {items.map((it) => (
          <a
            key={it.href}
            href={it.href}
            className={`flex min-h-24 items-end rounded-3xl ${it.tone} p-4 text-base font-semibold leading-tight`}
          >
            {it.label}
          </a>
        ))}
      </div>
      <LinkButton href={`${base}/hoy`} variant="outline">
        Volver a Hoy
      </LinkButton>
    </div>
  );
}

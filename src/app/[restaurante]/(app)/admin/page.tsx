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
  const groups: { title: string; items: { href: string; label: string; tone: string }[] }[] = [
    {
      title: "Día a día",
      items: [
        { href: `${base}/resumen`, label: "Resumen diario", tone: "bg-lav" },
        { href: `${base}/cuadres`, label: "Cuadres de caja", tone: "bg-peach" },
        { href: `${base}/cierre-dia`, label: "Cerrar el día", tone: "bg-mint" },
      ],
    },
    {
      title: "Análisis",
      items: [
        { href: `${base}/balance`, label: "Estado de resultados (mes)", tone: "bg-lav" },
        { href: `${base}/analitica`, label: "Analítica y control", tone: "bg-mint" },
        { href: `${base}/costos-fijos`, label: "Costos fijos", tone: "bg-peach" },
        { href: `${base}/historico`, label: "Histórico de platos", tone: "bg-sand" },
      ],
    },
    {
      title: "Platos e inventario",
      items: [
        { href: `${base}/catalogo`, label: "Catálogo de platos", tone: "bg-lav" },
        { href: `${base}/inventario`, label: "Inventario", tone: "bg-sand" },
        { href: `${base}/merma`, label: "Registrar daño / merma", tone: "bg-coral/15" },
      ],
    },
    {
      title: "Configuración",
      items: [
        { href: `${base}/usuarios`, label: "Usuarios y PINs", tone: "bg-lav" },
        { href: `${base}/turnos`, label: "Turnos", tone: "bg-peach" },
      ],
    },
    {
      title: "Auditoría",
      items: [
        { href: `${base}/bitacora`, label: "Bitácora", tone: "bg-ink/5" },
        { href: `${base}/reversar`, label: "Reversar / anular", tone: "bg-coral/15" },
      ],
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageTitle title="Administrar" subtitle="El control del negocio, ordenado" />
      {groups.map((g) => (
        <div key={g.title} className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-50">{g.title}</p>
          <div className="grid grid-cols-2 gap-3">
            {g.items.map((it) => (
              <a
                key={it.href}
                href={it.href}
                className={`flex min-h-20 items-end rounded-3xl ${it.tone} p-4 text-base font-semibold leading-tight`}
              >
                {it.label}
              </a>
            ))}
          </div>
        </div>
      ))}
      <LinkButton href={`${base}/hoy`} variant="outline">
        Volver a Hoy
      </LinkButton>
    </div>
  );
}

import Link from "next/link";

export default async function TurnoCerradoPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurante: string }>;
  searchParams: Promise<{
    exp?: string;
    cnt?: string;
    dif?: string;
    fl?: string;
    dep?: string;
  }>;
}) {
  const { restaurante } = await params;
  const { dif, dep } = await searchParams;
  const diff = Number(dif ?? 0);
  const cuadra = Math.abs(diff) < 0.005;
  const difClass = cuadra ? "text-blue" : diff > 0 ? "text-teal" : "text-coral";
  const difLabel = cuadra ? "Caja exacta" : diff > 0 ? "Sobró" : "Faltó";
  const entrega = Number(dep ?? 0);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6 text-center">
      <div>
        <p className="text-5xl">✅</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Caja cerrada</h1>
        <p className="mt-1 text-sm opacity-60">
          El turno quedó cerrado. Todas salieron de la sesión.
        </p>
      </div>

      <div className="rounded-3xl border border-ink/10 p-5">
        <p className="text-xs opacity-60">Efectivo para entregar a la jefa</p>
        <p className="text-3xl font-bold">${entrega.toFixed(2)}</p>
        {dif != null && (
          <p className={`mt-2 text-sm font-semibold ${difClass}`}>
            {difLabel}: ${diff.toFixed(2)}
          </p>
        )}
      </div>

      <Link
        href={`/${restaurante}`}
        className="rounded-full bg-ink py-4 font-semibold text-white"
      >
        Volver al inicio
      </Link>
    </main>
  );
}

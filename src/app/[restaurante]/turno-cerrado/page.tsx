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
  const { exp, cnt, dif, fl, dep } = await searchParams;
  const diff = Number(dif ?? 0);
  const cuadra = Math.abs(diff) < 0.005;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6 text-center">
      <h1 className="text-3xl font-bold tracking-tight">Turno cerrado</h1>

      {exp != null && (
        <div className="rounded-3xl border border-ink/10 p-5 text-left">
          <Row label="Caja esperada" value={Number(exp)} />
          <Row label="Caja contada" value={Number(cnt ?? 0)} />
          <div className="my-2 border-t border-ink/10" />
          <div className="flex justify-between font-bold">
            <span>Descuadre</span>
            <span className={cuadra ? "text-teal" : "text-coral"}>
              ${diff.toFixed(2)}
            </span>
          </div>
          {(fl != null || dep != null) && (
            <>
              <div className="my-2 border-t border-ink/10" />
              <Row label="Caja que dejaste" value={Number(fl ?? 0)} />
              <Row label="Efectivo entregado a la jefa" value={Number(dep ?? 0)} />
            </>
          )}
        </div>
      )}

      <Link
        href={`/${restaurante}`}
        className="rounded-full bg-ink py-4 font-semibold text-white"
      >
        Ingresar de nuevo
      </Link>
    </main>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between py-1 text-sm">
      <span className="opacity-60">{label}</span>
      <span>${value.toFixed(2)}</span>
    </div>
  );
}

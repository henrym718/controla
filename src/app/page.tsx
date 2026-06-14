import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-8 p-8 text-center">
      <div className="relative">
        <span className="blob absolute -left-10 -top-6 h-16 w-16 bg-coral/70" />
        <span className="blob absolute -right-8 top-8 h-12 w-12 bg-purple/60" />
        <h1 className="relative text-5xl font-bold tracking-tight">Controla</h1>
      </div>
      <p className="text-base opacity-60">
        El control de tu restaurante, hablando. Sin fricción.
      </p>
      <Link
        href="/rincon-de-mi-hermana"
        className="rounded-full bg-ink px-7 py-4 text-base font-semibold text-white"
      >
        Entrar al restaurante demo
      </Link>
      <p className="text-xs opacity-40">
        Cada restaurante tiene su ruta: /tu-restaurante
      </p>
      <Link href="/panel" className="text-xs font-semibold underline opacity-50">
        Panel de administración
      </Link>
    </main>
  );
}

"use client";

import { useRouter, usePathname } from "next/navigation";

/**
 * Botón Volver. Navega al "padre" lógico (no usa history para no repetir
 * cambios de filtro). Subvistas de admin → /admin; el resto → /hoy.
 */
export function BackButton() {
  const router = useRouter();
  const pathname = usePathname();
  const segs = pathname.split("/").filter(Boolean); // [slug, page]
  const slug = segs[0];
  const page = segs[1];

  if (!page || page === "hoy" || page === "capturar") return null;

  const target =
    page === "admin" || page === "cierre-turno" || page === "cuentas-por-cobrar"
      ? `/${slug}/hoy`
      : `/${slug}/admin`;

  return (
    <button
      onClick={() => router.push(target)}
      className="flex items-center gap-1 rounded-full bg-ink/5 px-3 py-2 text-sm font-semibold"
      aria-label="Volver"
    >
      <span className="text-base leading-none">‹</span> Volver
    </button>
  );
}

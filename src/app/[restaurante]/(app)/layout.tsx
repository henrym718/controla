import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { logoutAction } from "../actions";
import { BackButton } from "@/components/back-button";

export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session || session.slug !== restaurante) redirect(`/${restaurante}`);

  const db = createAdminClient();
  const { data: ss } = await db
    .from("shift_sessions")
    .select("status")
    .eq("id", session.shift_session_id)
    .maybeSingle();
  if (!ss || ss.status !== "open") redirect(`/${restaurante}?cerrado=1`);

  const { data: shift } = await db
    .from("shifts")
    .select("name")
    .eq("id", session.shift_id)
    .maybeSingle();

  const isAdmin = session.user_role === "admin";

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col">
      <header className="flex items-center justify-between gap-2 px-5 pb-2 pt-5">
        <div className="flex items-center gap-2">
          <BackButton />
          <div className="leading-tight">
            <p className="text-base font-bold">{session.user_name}</p>
            <p className="text-xs opacity-50">Turno {shift?.name}</p>
          </div>
        </div>
        <form action={logoutAction}>
          <button className="rounded-full bg-ink/5 px-4 py-2 text-sm font-semibold">
            Salir
          </button>
        </form>
      </header>

      <main className="flex-1 px-5 pb-28 pt-2">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 mx-auto flex max-w-md items-center justify-around bg-ink px-2 py-3 text-white"
           style={{ borderTopLeftRadius: 28, borderTopRightRadius: 28 }}>
        <Tab href={`/${restaurante}/hoy`} label="Hoy" />
        <Tab href={`/${restaurante}/cierre-turno`} label="Cierre" />
        {isAdmin && <Tab href={`/${restaurante}/admin`} label="Admin" />}
      </nav>
    </div>
  );
}

function Tab({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="px-3 py-2 text-sm font-medium text-white/80">
      {label}
    </Link>
  );
}

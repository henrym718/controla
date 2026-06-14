"use client";

import { useState, useTransition } from "react";
import {
  superLogoutAction,
  crearRestauranteAction,
  crearUsuarioPanelAction,
  toggleRestauranteAction,
} from "./actions";

export interface UserRow {
  id: string;
  name: string;
  role: string;
  active: boolean;
}
export interface RestaurantRow {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  users: UserRow[];
}

const input =
  "w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-black outline-none focus:border-black/50";
const btnDark =
  "rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
const btnLine =
  "rounded-lg border border-black/15 px-3 py-2 text-sm font-semibold text-black hover:bg-black/5";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function Icon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export default function PanelClient({ restaurants }: { restaurants: RestaurantRow[] }) {
  return (
    <div className="flex min-h-screen bg-white text-black">
      {/* Sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-black/10 p-4 sm:flex">
        <div className="mb-6 px-2 text-lg font-bold tracking-tight">Controla</div>
        <nav className="flex flex-col gap-1">
          <span className="flex items-center gap-3 rounded-lg bg-black/5 px-3 py-2 text-sm font-semibold">
            <Icon d="M3 9l1-5h16l1 5M4 9v10a1 1 0 001 1h14a1 1 0 001-1V9M4 9h16" />
            Restaurantes
          </span>
        </nav>
        <p className="mt-auto px-2 text-[11px] text-black/40">Panel de plataforma</p>
      </aside>

      {/* Contenido */}
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-black/10 px-5 py-3">
          <h1 className="text-base font-bold">Restaurantes</h1>
          <form action={superLogoutAction}>
            <button className={btnLine}>Salir</button>
          </form>
        </header>

        <main className="mx-auto w-full max-w-3xl flex-1 p-5">
          <CrearRestaurante />
          <div className="mt-6 flex flex-col gap-3">
            {restaurants.length === 0 && (
              <p className="rounded-xl border border-black/10 p-6 text-center text-sm text-black/50">
                Aún no hay restaurantes. Crea el primero arriba.
              </p>
            )}
            {restaurants.map((r) => (
              <RestaurantCard key={r.id} r={r} />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

function CrearRestaurante() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [adminName, setAdminName] = useState("");
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const onName = (v: string) => {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  };

  const submit = () => {
    setMsg(null);
    start(async () => {
      const r = await crearRestauranteAction({ name, slug, adminName, adminPin: pin });
      if (r.error) setMsg(r.error);
      else {
        setName("");
        setSlug("");
        setSlugTouched(false);
        setAdminName("");
        setPin("");
        setMsg("✓ Restaurante creado.");
      }
    });
  };

  return (
    <section className="rounded-xl border border-black/10 p-4">
      <p className="mb-3 flex items-center gap-2 text-sm font-bold">
        <Icon d="M12 5v14M5 12h14" /> Nuevo restaurante
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-medium text-black/60">
          Nombre del restaurante
          <input className={`mt-1 ${input}`} value={name} onChange={(e) => onName(e.target.value)} placeholder="Ej. Comedor de Ana" />
        </label>
        <label className="text-xs font-medium text-black/60">
          Enlace (URL)
          <input
            className={`mt-1 ${input}`}
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(slugify(e.target.value));
            }}
            placeholder="comedor-de-ana"
          />
        </label>
        <label className="text-xs font-medium text-black/60">
          Nombre del admin
          <input className={`mt-1 ${input}`} value={adminName} onChange={(e) => setAdminName(e.target.value)} placeholder="Ana" />
        </label>
        <label className="text-xs font-medium text-black/60">
          PIN del admin (6 dígitos)
          <input
            className={`mt-1 ${input}`}
            value={pin}
            inputMode="numeric"
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="••••••"
          />
        </label>
      </div>
      {slug && (
        <p className="mt-2 text-xs text-black/50">
          URL: <span className="font-mono">/{slug}</span>
        </p>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button onClick={submit} disabled={pending} className={btnDark}>
          {pending ? "Creando…" : "Crear restaurante"}
        </button>
        {msg && <span className="text-sm text-black/70">{msg}</span>}
      </div>
    </section>
  );
}

function RestaurantCard({ r }: { r: RestaurantRow }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);

  const url = typeof window !== "undefined" ? `${window.location.origin}/${r.slug}` : `/${r.slug}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  const wa = `https://wa.me/?text=${encodeURIComponent(`Entra a ${r.name}: ${url}`)}`;

  return (
    <section className={`rounded-xl border p-4 ${r.active ? "border-black/15" : "border-black/10 opacity-60"}`}>
      <div className="flex items-start justify-between gap-3">
        <button onClick={() => setOpen((v) => !v)} className="text-left">
          <p className="font-bold">{r.name}</p>
          <p className="font-mono text-xs text-black/50">/{r.slug}</p>
          <p className="mt-0.5 text-[11px] text-black/50">
            {r.users.length} usuario(s){!r.active && " · inactivo"}
          </p>
        </button>
        <button
          onClick={() => start(async () => void (await toggleRestauranteAction(r.id, !r.active)))}
          disabled={pending}
          className={btnLine}
        >
          {r.active ? "Desactivar" : "Activar"}
        </button>
      </div>

      {/* Compartir URL */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="flex-1 truncate rounded-lg border border-black/10 bg-black/[0.03] px-3 py-2 text-xs">{url}</code>
        <button onClick={copy} className={btnLine}>{copied ? "✓ Copiado" : "Copiar"}</button>
        <a href={wa} target="_blank" rel="noopener noreferrer" className={btnLine}>WhatsApp</a>
      </div>

      <button onClick={() => setOpen((v) => !v)} className="mt-3 text-sm font-semibold text-black/70 hover:text-black">
        {open ? "Ocultar usuarios ▲" : "Ver / agregar usuarios ▼"}
      </button>

      {open && (
        <div className="mt-3 border-t border-black/10 pt-3">
          {r.users.length > 0 ? (
            <ul className="mb-3 flex flex-col gap-1">
              {r.users.map((u) => (
                <li key={u.id} className="flex items-center justify-between text-sm">
                  <span>
                    {u.name}
                    <span className="ml-2 rounded border border-black/15 px-1.5 py-0.5 text-[10px] uppercase text-black/60">
                      {u.role}
                    </span>
                  </span>
                  {!u.active && <span className="text-[11px] text-black/40">inactivo</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-black/50">Sin usuarios.</p>
          )}
          <AddUser restaurantId={r.id} />
        </div>
      )}
    </section>
  );
}

function AddUser({ restaurantId }: { restaurantId: string }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("empleado");
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    setMsg(null);
    start(async () => {
      const r = await crearUsuarioPanelAction({ restaurantId, name, role, pin });
      if (r.error) setMsg(r.error);
      else {
        setName("");
        setPin("");
        setMsg("✓ Usuario agregado.");
      }
    });
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs font-medium text-black/60">
        Nombre
        <input className={`mt-1 w-36 ${input}`} value={name} onChange={(e) => setName(e.target.value)} placeholder="María" />
      </label>
      <label className="text-xs font-medium text-black/60">
        Rol
        <select className={`mt-1 ${input}`} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="empleado">empleado</option>
          <option value="admin">admin</option>
        </select>
      </label>
      <label className="text-xs font-medium text-black/60">
        PIN (6 díg.)
        <input
          className={`mt-1 w-28 ${input}`}
          value={pin}
          inputMode="numeric"
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="••••••"
        />
      </label>
      <button onClick={submit} disabled={pending} className={btnDark}>
        {pending ? "…" : "Agregar"}
      </button>
      {msg && <span className="w-full text-xs text-black/70">{msg}</span>}
    </div>
  );
}

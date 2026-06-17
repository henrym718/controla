"use client";

import { useState, useTransition } from "react";
import { loginAction } from "./actions";

interface Shift {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
}

export default function LoginForm({
  slug,
  name,
  shifts,
  openShiftIds,
  closedNotice,
}: {
  slug: string;
  name: string;
  shifts: Shift[];
  openShiftIds: string[];
  closedNotice?: boolean;
}) {
  const [shiftId, setShiftId] = useState<string>(""); // sin turno marcado a propósito
  const [pin, setPin] = useState("");
  const [openingCash, setOpeningCash] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cajaInvalid, setCajaInvalid] = useState(false);
  const [pending, startTransition] = useTransition();

  // Si el turno elegido NO está abierto aún, este usuario lo ABRE → caja obligatoria.
  const opening = shiftId !== "" && !openShiftIds.includes(shiftId);

  const submit = () => {
    setError(null);
    setCajaInvalid(false);
    if (!shiftId) return setError("Elige tu turno.");
    if (pin.length < 3) return setError("Ingresa tu PIN.");
    const cajaBlank = openingCash.trim() === "";
    if (opening && cajaBlank) {
      setCajaInvalid(true);
      return setError("Escribe la caja inicial del turno (puede ser 0).");
    }
    startTransition(async () => {
      const res = await loginAction(
        slug,
        shiftId,
        pin,
        cajaBlank ? null : Number(openingCash),
      );
      if (res?.error) setError(res.error);
    });
  };

  const digit = (d: string) =>
    setPin((p) => (d === "←" ? p.slice(0, -1) : (p + d).slice(0, 6)));

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">{name}</h1>
        <p className="mt-1 text-sm opacity-50">Elige tu turno e ingresa tu PIN</p>
      </div>

      {closedNotice && (
        <p className="rounded-2xl bg-peach px-4 py-3 text-center text-sm font-medium">
          Tu turno fue cerrado. Vuelve a ingresar para abrir uno nuevo.
        </p>
      )}

      <div className="grid grid-cols-3 gap-2">
        {shifts.map((s) => {
          const isOpen = openShiftIds.includes(s.id);
          return (
            <button
              key={s.id}
              onClick={() => setShiftId(s.id)}
              className={`rounded-2xl p-3 text-sm font-semibold transition ${
                shiftId === s.id ? "bg-ink text-white" : "bg-lav text-ink"
              }`}
            >
              {s.name}
              <span className="block text-[10px] font-normal opacity-70">
                {isOpen ? "abierto" : `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`}
              </span>
            </button>
          );
        })}
      </div>

      <div className="h-10 text-center font-mono text-4xl tracking-[0.3em]">
        {pin.replace(/./g, "•")}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "←", "0", "OK"].map((k) => (
          <button
            key={k}
            onClick={() => (k === "OK" ? submit() : digit(k))}
            disabled={pending}
            className={`rounded-2xl py-4 text-xl font-semibold transition active:scale-95 ${
              k === "OK" ? "bg-coral text-white" : "bg-lav text-ink"
            }`}
          >
            {k}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <input
          inputMode="decimal"
          value={openingCash}
          onChange={(e) => {
            setOpeningCash(e.target.value);
            if (cajaInvalid) setCajaInvalid(false);
          }}
          placeholder={
            opening ? "Caja inicial (escribe 0 si no hay)" : "Corregir caja (deja 0 si no cambia)"
          }
          className={`rounded-2xl border px-4 py-3 text-sm outline-none ${
            cajaInvalid ? "border-coral focus:border-coral" : "border-ink/15 focus:border-ink/40"
          }`}
        />
        {opening && (
          <p className="px-1 text-xs opacity-50">
            Vas a ABRIR este turno: escribe la caja con la que inicias.
          </p>
        )}
        {shiftId !== "" && !opening && (
          <p className="px-1 text-xs opacity-50">
            Te unes a un turno ya abierto. Escribe un monto solo si quieres corregir la caja
            inicial; 0 o vacío la dejan igual.
          </p>
        )}
      </div>

      {error && <p className="text-center text-sm font-medium text-coral">{error}</p>}
      {pending && <p className="text-center text-sm opacity-50">Ingresando…</p>}
    </main>
  );
}

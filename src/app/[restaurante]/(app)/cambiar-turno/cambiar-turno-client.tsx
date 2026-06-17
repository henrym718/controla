"use client";

import { useState, useTransition } from "react";
import { PageTitle } from "@/components/ui";
import { cambiarTurnoAction } from "../../actions";

interface ShiftOpt {
  id: string;
  name: string;
  start: string;
  end: string;
}

export default function CambiarTurnoClient({
  shifts,
  openShiftIds,
  currentShiftId,
}: {
  shifts: ShiftOpt[];
  openShiftIds: string[];
  currentShiftId: string;
}) {
  const [shiftId, setShiftId] = useState("");
  const [openingCash, setOpeningCash] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cajaInvalid, setCajaInvalid] = useState(false);
  const [pending, start] = useTransition();

  // Si el turno destino no está abierto, este usuario lo ABRE → caja obligatoria.
  const opening = shiftId !== "" && !openShiftIds.includes(shiftId);

  const submit = () => {
    setError(null);
    setCajaInvalid(false);
    if (!shiftId) return setError("Elige el turno correcto.");
    const cajaBlank = openingCash.trim() === "";
    if (opening && cajaBlank) {
      setCajaInvalid(true);
      return setError("Escribe la caja inicial del turno (puede ser 0).");
    }
    start(async () => {
      const res = await cambiarTurnoAction(shiftId, cajaBlank ? null : Number(openingCash));
      if (res?.error) setError(res.error);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Cambiar turno" />
      <p className="text-sm opacity-60">
        ¿Te equivocaste de turno al ingresar? Elige el correcto. Si el turno anterior quedó sin
        movimientos, se descarta.
      </p>

      <div className="grid grid-cols-3 gap-2">
        {shifts.map((s) => {
          const isCurrent = s.id === currentShiftId;
          const isOpen = openShiftIds.includes(s.id);
          return (
            <button
              key={s.id}
              disabled={isCurrent}
              onClick={() => setShiftId(s.id)}
              className={`rounded-2xl p-3 text-sm font-semibold transition ${
                isCurrent
                  ? "bg-ink/10 text-ink/40"
                  : shiftId === s.id
                    ? "bg-ink text-white"
                    : "bg-lav text-ink"
              }`}
            >
              {s.name}
              <span className="block text-[10px] font-normal opacity-70">
                {isCurrent ? "actual" : isOpen ? "abierto" : `${s.start.slice(0, 5)}–${s.end.slice(0, 5)}`}
              </span>
            </button>
          );
        })}
      </div>

      {shiftId !== "" && (
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
          <p className="px-1 text-xs opacity-50">
            {opening
              ? "Vas a ABRIR este turno: escribe la caja con la que inicias."
              : "Turno ya abierto. Escribe un monto solo si quieres corregir la caja inicial; 0 o vacío la dejan igual."}
          </p>
        </div>
      )}

      <button
        onClick={submit}
        disabled={pending || !shiftId}
        className="rounded-full bg-coral py-3 font-semibold text-white disabled:opacity-40"
      >
        {pending ? "Cambiando…" : "Cambiar a este turno"}
      </button>

      {error && <p className="text-center text-sm font-medium text-coral">{error}</p>}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Button, Card, Field, Input, PageTitle } from "@/components/ui";
import { actualizarTurno, crearTurno, eliminarTurno } from "../admin/actions";

interface Shift {
  id: string;
  name: string;
  start: string;
  end: string;
  active: boolean;
  isAllDay: boolean;
}

export default function TurnosClient({ shifts }: { shifts: Shift[] }) {
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTr] = useTransition();

  const crear = () => {
    setMsg(null);
    if (!name.trim() || !start || !end) {
      setMsg("Completa nombre, inicio y fin.");
      return;
    }
    startTr(async () => {
      const r = await crearTurno({ name: name.trim(), start, end });
      setMsg(r.error ?? "Turno creado.");
      if (!r.error) {
        setName("");
        setStart("");
        setEnd("");
      }
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <PageTitle title="Turnos" subtitle="Define las franjas y sus horarios" />

      <Card className="flex flex-col gap-3 bg-mint">
        <p className="font-semibold">Nuevo turno</p>
        <Field label="Nombre">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mañana, Tarde, Todo el día…"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Inicio">
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Fin">
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <Button onClick={crear} disabled={pending}>
          {pending ? "Guardando…" : "Crear turno"}
        </Button>
        {msg && <p className="text-center text-sm opacity-70">{msg}</p>}
      </Card>

      <div className="flex flex-col gap-2">
        {shifts.map((s) => (
          <TurnoCard key={s.id} shift={s} />
        ))}
      </div>
    </div>
  );
}

function TurnoCard({ shift }: { shift: Shift }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(shift.name);
  const [start, setStart] = useState(shift.start.slice(0, 5));
  const [end, setEnd] = useState(shift.end.slice(0, 5));
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTr] = useTransition();

  const guardar = () => {
    setMsg(null);
    if (!name.trim() || !start || !end) return setMsg("Completa nombre, inicio y fin.");
    startTr(async () => {
      const r = await actualizarTurno(shift.id, { name: name.trim(), start, end });
      if (r.error) setMsg(r.error);
      else setEditing(false);
    });
  };

  if (editing) {
    return (
      <Card className="flex flex-col gap-3 bg-lav">
        <Field label="Nombre">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Inicio">
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Fin">
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <div className="flex gap-2">
          <Button onClick={guardar} disabled={pending} className="flex-1">
            {pending ? "Guardando…" : "Guardar"}
          </Button>
          <button
            onClick={() => setEditing(false)}
            className="rounded-full border border-ink/15 px-5 py-2 text-sm font-semibold"
          >
            Cancelar
          </button>
        </div>
        {msg && <p className="text-center text-sm text-coral">{msg}</p>}
      </Card>
    );
  }

  return (
    <Card className={shift.active ? "" : "opacity-50"}>
      <div className="flex items-center justify-between">
        <div>
          <p className="flex items-center gap-1.5 font-semibold">
            {shift.name}
            {shift.isAllDay && (
              <span className="rounded-full bg-mint px-2 py-0.5 text-[10px] font-semibold">
                fijo
              </span>
            )}
          </p>
          <p className="text-xs opacity-60">
            {shift.isAllDay
              ? "Siempre disponible · su menú se vende en todos los turnos"
              : `${shift.start.slice(0, 5)}–${shift.end.slice(0, 5)}`}
          </p>
        </div>
        {shift.isAllDay ? (
          <span className="text-xs opacity-50">No se elimina</span>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditing(true)}
              className="rounded-full bg-ink/10 px-4 py-2 text-sm font-semibold"
            >
              Editar
            </button>
            <button
              onClick={() => {
                if (window.confirm(`¿Eliminar turno ${shift.name}?`))
                  startTr(() => void eliminarTurno(shift.id));
              }}
              className="rounded-full bg-coral/10 px-4 py-2 text-sm font-semibold text-coral"
            >
              Eliminar
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}

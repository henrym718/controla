"use client";

import { useState, useTransition } from "react";
import { Button, Card, Field, Input, PageTitle } from "@/components/ui";
import { crearTurno, eliminarTurno } from "../admin/actions";

interface Shift {
  id: string;
  name: string;
  start: string;
  end: string;
  active: boolean;
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
          <Card key={s.id} className={s.active ? "" : "opacity-50"}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">{s.name}</p>
                <p className="text-xs opacity-60">
                  {s.start.slice(0, 5)}–{s.end.slice(0, 5)}
                </p>
              </div>
              <button
                onClick={() => {
                  if (window.confirm(`¿Eliminar turno ${s.name}?`))
                    startTr(() => void eliminarTurno(s.id));
                }}
                className="rounded-full bg-coral/10 px-4 py-2 text-sm font-semibold text-coral"
              >
                Eliminar
              </button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Button, Card, Field, Input, PageTitle, Tag } from "@/components/ui";
import {
  crearUsuario,
  toggleUsuario,
  eliminarUsuario,
  cambiarPin,
} from "../admin/actions";

interface Shift {
  id: string;
  name: string;
  start: string;
  end: string;
}
interface User {
  id: string;
  name: string;
  role: string;
  active: boolean;
  shiftId: string | null;
  start: string | null;
  end: string | null;
}

const selectCls =
  "w-full rounded-2xl border border-ink/15 bg-white px-4 py-3 text-base outline-none focus:border-ink/40";

export default function UsuariosClient({
  users,
  shifts,
}: {
  users: User[];
  shifts: Shift[];
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("empleado");
  const [pin, setPin] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const shiftName = (id: string | null) =>
    shifts.find((s) => s.id === id)?.name ?? null;

  const crear = () => {
    setMsg(null);
    if (!name.trim() || pin.length < 3) {
      setMsg("Nombre y PIN (mín. 3 dígitos) son obligatorios.");
      return;
    }
    start(async () => {
      const r = await crearUsuario({
        name: name.trim(),
        role,
        pin,
        shiftId: role === "admin" ? null : shiftId || null,
      });
      setMsg(r.error ?? "Usuario creado.");
      if (!r.error) {
        setName("");
        setPin("");
        setShiftId("");
      }
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <PageTitle title="Usuarios y PINs" subtitle="Cada PIN es un usuario" />

      <Card className="flex flex-col gap-3 bg-lav">
        <p className="font-semibold">Nuevo usuario</p>
        <Field label="Nombre">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rol">
            <select className={selectCls} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="empleado">Empleado</option>
              <option value="admin">Admin (sin horario)</option>
            </select>
          </Field>
          <Field label="PIN">
            <Input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              placeholder="••••"
            />
          </Field>
        </div>
        {role !== "admin" && (
          <Field label="Turno (horario)">
            <select className={selectCls} value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
              <option value="">Sin turno fijo</option>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.start.slice(0, 5)}–{s.end.slice(0, 5)})
                </option>
              ))}
            </select>
          </Field>
        )}
        <Button onClick={crear} disabled={pending}>
          {pending ? "Guardando…" : "Crear usuario"}
        </Button>
        {msg && <p className="text-center text-sm opacity-70">{msg}</p>}
      </Card>

      <div className="flex flex-col gap-2">
        {users.map((u) => (
          <Card key={u.id} className={u.active ? "" : "opacity-50"}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">
                  {u.name}{" "}
                  <Tag tone={u.role === "admin" ? "peach" : "mint"}>{u.role}</Tag>
                </p>
                <p className="text-xs opacity-60">
                  {u.role === "admin"
                    ? "Sin horario"
                    : shiftName(u.shiftId)
                      ? `Turno ${shiftName(u.shiftId)}`
                      : u.start
                        ? `${u.start.slice(0, 5)}–${u.end?.slice(0, 5)}`
                        : "Sin turno fijo"}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <RowBtn
                label={u.active ? "Desactivar" : "Activar"}
                onClick={() => start(() => void toggleUsuario(u.id, !u.active))}
              />
              <RowBtn
                label="Cambiar PIN"
                onClick={() => {
                  const p = window.prompt(`Nuevo PIN para ${u.name}`);
                  if (p) start(async () => void (await cambiarPin(u.id, p)));
                }}
              />
              <RowBtn
                label="Eliminar"
                danger
                onClick={() => {
                  if (window.confirm(`¿Eliminar a ${u.name}?`))
                    start(() => void eliminarUsuario(u.id));
                }}
              />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function RowBtn({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-semibold ${
        danger ? "bg-coral/10 text-coral" : "bg-ink/5 text-ink"
      }`}
    >
      {label}
    </button>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Button, Card, Field, Input, PageTitle, Tag } from "@/components/ui";
import { Switch } from "@/components/ui/switch";
import { crearCliente, toggleCliente } from "./actions";

interface Cliente {
  id: string;
  name: string;
  kind: "cliente" | "empleado";
  active: boolean;
  saldo: number;
}

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

export default function ClientesClient({ clientes }: { clientes: Cliente[] }) {
  const [name, setName] = useState("");
  const [empleado, setEmpleado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const crear = () => {
    setMsg(null);
    if (!name.trim()) {
      setMsg("Escribe el nombre.");
      return;
    }
    start(async () => {
      const r = await crearCliente({
        name: name.trim(),
        kind: empleado ? "empleado" : "cliente",
      });
      setMsg(r.error ?? "Persona registrada.");
      if (!r.error) {
        setName("");
        setEmpleado(false);
      }
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <PageTitle title="Clientes (fiado)" subtitle="Quiénes pueden comprar a crédito" />

      <Card className="flex flex-col gap-3 bg-lav">
        <p className="font-semibold">Registrar persona</p>
        <Field label="Nombre">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre de la persona"
          />
        </Field>
        <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3">
          <div>
            <p className="text-sm font-semibold">{empleado ? "Empleado" : "Cliente"}</p>
            <p className="text-xs opacity-60">
              {empleado ? "Trabaja en el negocio" : "Cliente del local"}
            </p>
          </div>
          <Switch checked={empleado} onCheckedChange={(v) => setEmpleado(v)} />
        </div>
        <Button onClick={crear} disabled={pending}>
          {pending ? "Guardando…" : "Agregar"}
        </Button>
        {msg && <p className="text-center text-sm opacity-70">{msg}</p>}
      </Card>

      <div className="flex flex-col gap-2">
        {clientes.length === 0 && (
          <p className="rounded-3xl bg-ink/[0.03] px-4 py-8 text-center text-sm opacity-60">
            Aún no registras a nadie. Agrega arriba a quienes podrán llevar fiado.
          </p>
        )}
        {clientes.map((c) => (
          <Card key={c.id} className={c.active ? "" : "opacity-50"}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold leading-tight">
                  {c.name}{" "}
                  <Tag tone={c.kind === "empleado" ? "peach" : "mint"}>{c.kind}</Tag>
                </p>
                <p className="mt-0.5 text-xs">
                  {c.saldo > 0 ? (
                    <span className="font-semibold text-coral">Debe {money(c.saldo)}</span>
                  ) : (
                    <span className="opacity-50">Sin deuda</span>
                  )}
                </p>
              </div>
              <button
                onClick={() => start(() => void toggleCliente(c.id, !c.active))}
                className="shrink-0 rounded-full bg-ink/5 px-4 py-2 text-sm font-semibold text-ink"
              >
                {c.active ? "Desactivar" : "Activar"}
              </button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

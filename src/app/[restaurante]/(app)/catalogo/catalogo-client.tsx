"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, Card, Field, Input, PageTitle } from "@/components/ui";
import { crearPlato, eliminarPlato } from "../admin/actions";

interface Dish {
  id: string;
  name: string;
  price: number;
  active: boolean;
}

export default function CatalogoClient({
  slug,
  dishes,
}: {
  slug: string;
  dishes: Dish[];
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const crear = () => {
    setMsg(null);
    const p = Number(price);
    if (!name.trim() || !p) {
      setMsg("Completa nombre y precio.");
      return;
    }
    start(async () => {
      const r = await crearPlato({ name: name.trim(), price: p });
      setMsg(r.error ?? "Plato creado.");
      if (!r.error) {
        setName("");
        setPrice("");
      }
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        title="Catálogo de platos"
        subtitle="Registra cada plato una vez; así se guarda su historial de costo"
      />

      <Card className="flex flex-col gap-3 bg-lav">
        <p className="font-semibold">Nuevo plato</p>
        <Field label="Nombre">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Seco de pollo, Arroz con menestra…"
          />
        </Field>
        <Field label="Precio de venta">
          <Input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
          />
        </Field>
        <Button onClick={crear} disabled={pending}>
          {pending ? "Guardando…" : "Crear plato"}
        </Button>
        {msg && <p className="text-center text-sm opacity-70">{msg}</p>}
      </Card>

      <div className="flex flex-col gap-2">
        {dishes.map((d) => (
          <Card key={d.id} className={d.active ? "" : "opacity-50"}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">{d.name}</p>
                <p className="text-xs opacity-60">${d.price.toFixed(2)}</p>
              </div>
              <div className="flex gap-2">
                <Link
                  href={`/${slug}/historico?dish=${d.id}`}
                  className="rounded-full bg-ink/5 px-4 py-2 text-sm font-semibold"
                >
                  Historial
                </Link>
                <button
                  onClick={() => {
                    if (window.confirm(`¿Eliminar ${d.name}?`))
                      start(() => void eliminarPlato(d.id));
                  }}
                  className="rounded-full bg-coral/10 px-4 py-2 text-sm font-semibold text-coral"
                >
                  Quitar
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

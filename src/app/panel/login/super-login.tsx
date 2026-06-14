"use client";

import { useState, useTransition } from "react";
import { superLoginAction } from "../actions";

export default function SuperLogin() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const digit = (d: string) =>
    setPin((p) => (d === "←" ? p.slice(0, -1) : (p + d).slice(0, 6)));

  const submit = () => {
    setError(null);
    if (pin.length < 4) return setError("El PIN tiene de 4 a 6 dígitos.");
    start(async () => {
      const r = await superLoginAction(pin);
      if (r?.error) {
        setError(r.error);
        setPin("");
      }
    });
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-xs flex-col justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">Panel · Controla</h1>
        <p className="mt-1 text-sm text-black/50">Ingresa tu PIN de plataforma</p>
      </div>

      <div className="h-10 text-center font-mono text-4xl tracking-[0.3em] text-black">
        {pin.replace(/./g, "•")}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "←", "0", "OK"].map((k) => (
          <button
            key={k}
            onClick={() => (k === "OK" ? submit() : digit(k))}
            disabled={pending}
            className={`rounded-xl border py-4 text-xl font-semibold transition active:scale-95 ${
              k === "OK"
                ? "border-black bg-black text-white"
                : "border-black/15 bg-white text-black hover:bg-black/5"
            }`}
          >
            {k}
          </button>
        ))}
      </div>

      {error && <p className="text-center text-sm font-medium text-black">{error}</p>}
      {pending && <p className="text-center text-sm text-black/50">Ingresando…</p>}
    </main>
  );
}

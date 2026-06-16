"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageTitle, Card, Tag, Modal } from "@/components/ui";
import { registrarCobroCredito, historialCliente, type HistorialItem } from "./actions";

interface Deudor {
  id: string;
  name: string;
  kind: "cliente" | "empleado";
  saldo: number;
}

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

export default function CuentasPorCobrarClient({ deudores }: { deudores: Deudor[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<Deudor | null>(null);
  const [hist, setHist] = useState<HistorialItem[] | null>(null);
  const [monto, setMonto] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [, startLoad] = useTransition();

  const total = deudores.reduce((s, d) => s + d.saldo, 0);

  const abrir = (d: Deudor) => {
    setSel(d);
    setHist(null);
    setMonto(d.saldo.toFixed(2));
    setMsg(null);
    startLoad(async () => {
      const r = await historialCliente(d.id);
      setHist(r.items);
    });
  };
  const cerrar = () => {
    setSel(null);
    setHist(null);
    setMsg(null);
  };
  const cobrar = () => {
    if (!sel || pending) return;
    const amt = Math.round(Number(monto.replace(",", ".")) * 100) / 100;
    if (!(amt > 0)) {
      setMsg("Escribe un monto válido.");
      return;
    }
    if (amt > sel.saldo + 0.001) {
      setMsg(`No puede ser más que la deuda (${money(sel.saldo)}).`);
      return;
    }
    start(async () => {
      const r = await registrarCobroCredito(sel.id, amt);
      if (r.error) setMsg(r.error);
      else {
        cerrar();
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        title="Cuentas por cobrar"
        subtitle={
          deudores.length
            ? `${deudores.length} ${deudores.length === 1 ? "persona debe" : "personas deben"} · ${money(total)}`
            : "Quién debe y cuánto"
        }
      />

      {deudores.length === 0 ? (
        <Card className="text-center">
          <p className="text-sm opacity-60">Nadie debe nada por ahora. 🎉</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {deudores.map((d) => (
            <button
              key={d.id}
              onClick={() => abrir(d)}
              className="rounded-3xl border border-ink/10 bg-white p-4 text-left"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold leading-tight">
                    {d.name} <Tag tone={d.kind === "empleado" ? "peach" : "mint"}>{d.kind}</Tag>
                  </p>
                  <p className="mt-0.5 text-xs opacity-50">Toca para ver y cobrar</p>
                </div>
                <p className="shrink-0 text-lg font-bold tabular-nums text-coral">{money(d.saldo)}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      <Modal open={!!sel} onClose={cerrar}>
        {sel && (
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-lg font-bold">{sel.name}</p>
              <p className="text-sm opacity-60">
                Debe <span className="font-bold text-coral">{money(sel.saldo)}</span>
              </p>
            </div>

            <div className="max-h-56 overflow-y-auto rounded-2xl bg-ink/[0.03] p-2">
              {hist === null ? (
                <p className="px-2 py-4 text-center text-sm opacity-50">Cargando…</p>
              ) : hist.length === 0 ? (
                <p className="px-2 py-4 text-center text-sm opacity-50">Sin movimientos.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {hist.map((h, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {h.tipo === "abono" ? "💵 " : ""}
                          {h.concepto}
                        </p>
                        <p className="text-xs opacity-50">{h.fecha}</p>
                      </div>
                      <p
                        className={`shrink-0 text-sm font-bold tabular-nums ${
                          h.tipo === "abono" ? "text-blue" : "text-ink"
                        }`}
                      >
                        {h.tipo === "abono" ? "−" : "+"}
                        {money(h.monto)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="mb-1 text-sm font-medium">Registrar cobro</p>
              <div className="flex gap-2">
                <input
                  value={monto}
                  onChange={(e) => setMonto(e.target.value.replace(/[^\d.,]/g, ""))}
                  inputMode="decimal"
                  className="w-full rounded-2xl border border-ink/15 bg-white px-4 py-3 text-lg font-bold outline-none focus:border-ink/40"
                />
                <button
                  onClick={cobrar}
                  disabled={pending}
                  className="shrink-0 rounded-full bg-coral px-6 font-bold text-white disabled:opacity-40"
                >
                  {pending ? "…" : "Cobrar"}
                </button>
              </div>
              {msg && <p className="mt-2 text-sm font-semibold text-coral">{msg}</p>}
              <p className="mt-1 text-xs opacity-50">
                Ese dinero entra a la caja como “cobro por cobrar”.
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

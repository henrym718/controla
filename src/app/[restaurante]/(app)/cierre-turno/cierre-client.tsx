"use client";

import { useState, useTransition } from "react";
import { cerrarTurnoAction } from "../../actions";
import { Button, Card, Field, Input, Modal, PageTitle } from "@/components/ui";

export interface CierreResumen {
  session_id: string;
  shift: string | null;
  responsable: string | null;
  ventas: {
    total: number;
    efectivo: number;
    transferencia: number;
    otro: number;
    n: number;
  };
  gastos: { total: number; items: { name: string; amount: number }[] };
  egresos: { total: number; items: { reason: string | null; amount: number }[] };
  aportes: number;
  caja: { apertura: number; esperada: number };
}

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

export default function CierreClient({
  resumen,
  ventasDetalle,
}: {
  slug: string;
  resumen: CierreResumen;
  ventasDetalle: { name: string; qty: number; total: number }[];
}) {
  const opening = Number(resumen.caja.apertura) || 0;
  const expected = Number(resumen.caja.esperada) || 0;

  const [counted, setCounted] = useState("");
  const [floatStr, setFloatStr] = useState(opening ? String(opening) : "");
  const [notes, setNotes] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const countedNum = Number(counted) || 0;
  const floatNum = Number(floatStr) || 0;
  const dif = countedNum - expected;
  const cuadra = Math.abs(dif) < 0.005;
  const entrega = countedNum - floatNum;
  const hasCount = counted !== "";

  const costosTotal = resumen.gastos.total + resumen.egresos.total;

  function confirmar() {
    startTransition(() => {
      void cerrarTurnoAction(countedNum, floatNum, notes);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Cerrar turno"
        subtitle={`Cuadre de caja${resumen.shift ? ` · ${resumen.shift}` : ""}`}
      />

      {/* RESUMEN DEL TURNO */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">
            Ventas <span className="opacity-50">· {resumen.ventas.n}</span>
          </p>
          <span className="font-bold">{money(resumen.ventas.total)}</span>
        </div>
        <div className="mt-1">
          <Sub label="Efectivo" value={resumen.ventas.efectivo} />
          <Sub label="Transferencia" value={resumen.ventas.transferencia} />
          {resumen.ventas.otro > 0 && <Sub label="Otro" value={resumen.ventas.otro} />}
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-ink/10 pt-2 text-sm">
          <span className="font-semibold">Costos del turno</span>
          <span className="font-bold">{money(costosTotal)}</span>
        </div>
        {(resumen.gastos.items.length > 0 || resumen.egresos.items.length > 0) && (
          <div className="mt-1">
            {resumen.gastos.items.map((g, i) => (
              <Sub key={`g${i}`} label={g.name} value={g.amount} />
            ))}
            {resumen.egresos.items.map((e, i) => (
              <Sub key={`e${i}`} label={e.reason ?? "Egreso de caja"} value={e.amount} />
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] opacity-50">
          ¿Gastaste en algo (servilletas, gas, fundas…) y no aparece? Regístralo antes de cerrar
          para que cuadre.
        </p>
      </Card>

      {/* ¿QUÉ VENDISTE? — detalle por ítem */}
      {ventasDetalle.length > 0 && (
        <Card className="p-4">
          <p className="mb-1 text-sm font-semibold">¿Qué vendiste?</p>
          <div className="mt-1">
            {ventasDetalle.map((v, i) => (
              <div key={i} className="flex items-center justify-between py-1 text-sm">
                <span className="opacity-70">
                  <span className="font-semibold">{v.qty}</span> × {v.name}
                </span>
                <span>{money(v.total)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* CAJA: esperada vs contada */}
      <Card className="p-4">
        <p className="mb-1 text-sm font-semibold">Caja</p>
        <Sub label="Caja inicial" value={opening} />
        {resumen.aportes > 0 && <Sub label="+ Aportes (jefa / ingresos)" value={resumen.aportes} />}
        <div className="flex items-center justify-between border-t border-ink/10 py-1.5 pt-2 text-sm font-semibold">
          <span>= Debe haber en caja</span>
          <span>{money(expected)}</span>
        </div>

        <div className="mt-3">
          <Field label="¿Cuánto efectivo contaste?">
            <Input
              inputMode="decimal"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              placeholder="0.00"
            />
          </Field>
        </div>

        {hasCount && (
          <div
            className={`mt-3 rounded-3xl p-4 text-center ${cuadra ? "bg-mint" : "bg-peach"}`}
          >
            <p className="text-lg font-bold">Descuadre: {money(dif)}</p>
            <p className="text-xs opacity-70">
              {cuadra ? "Cuadra perfecto" : dif < 0 ? "Falta dinero" : "Sobra dinero"}
            </p>
          </div>
        )}
      </Card>

      {/* CUÁNTO DEJA + EFECTIVO A ENTREGAR */}
      <Card className="p-4">
        <Field label="¿Cuánta caja dejas para el próximo turno?">
          <Input
            inputMode="decimal"
            value={floatStr}
            onChange={(e) => setFloatStr(e.target.value)}
            placeholder={String(opening)}
          />
        </Field>
        <div className="mt-3 rounded-3xl bg-lav p-4 text-center">
          <p className="text-xs opacity-60">Efectivo a entregar a la jefa</p>
          <p className="text-2xl font-bold">{hasCount ? money(entrega) : "—"}</p>
          <p className="text-xs opacity-50">
            Contaste {money(countedNum)} − caja que dejas {money(floatNum)}
          </p>
        </div>
      </Card>

      <Field label="Nota (opcional)">
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Ej. faltó cambio, propinas aparte…"
        />
      </Field>

      <Button variant="accent" onClick={() => setOpen(true)} disabled={!hasCount}>
        Cerrar turno y cuadrar caja
      </Button>
      <p className="text-center text-xs opacity-50">
        Al cerrar, todas las que trabajaron este turno saldrán de la sesión.
      </p>

      {/* MODAL · confirmación final */}
      <Modal open={open} onClose={() => !pending && setOpen(false)}>
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight">¿Cerrar el turno?</h2>
            <p className="text-xs opacity-50">
              {resumen.shift ?? "Turno"}
              {resumen.responsable ? ` · ${resumen.responsable}` : ""}
            </p>
          </div>

          <Card className="p-4">
            <Row label="Contaste" value={countedNum} />
            <Row label="Dejas en caja" value={floatNum} />
            <Row label="Entregas a la jefa" value={entrega} strong />
            <div className="mt-1 flex items-center justify-between border-t border-ink/10 pt-2 text-sm">
              <span className="opacity-60">Descuadre</span>
              <span className={`font-bold ${cuadra ? "text-teal" : "text-coral"}`}>
                {money(dif)}
              </span>
            </div>
          </Card>

          <p className="text-center text-xs opacity-60">
            Esto saca a todas del turno. No se podrá registrar más en esta sesión.
          </p>

          <Button variant="accent" onClick={confirmar} disabled={pending}>
            {pending ? "Cerrando…" : "Sí, cerrar turno"}
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Revisar de nuevo
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm opacity-60">{label}</span>
      <span className={strong ? "text-lg font-bold" : "text-sm"}>{money(value)}</span>
    </div>
  );
}

function Sub({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between py-1 text-xs opacity-70">
      <span className="capitalize">{label}</span>
      <span>{money(value)}</span>
    </div>
  );
}

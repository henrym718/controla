"use client";

import { useState, useTransition } from "react";
import { cerrarTurnoAction, registrarConteoAction } from "../../actions";
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

interface Props {
  slug: string;
  resumen: CierreResumen;
  ventasDetalle: { name: string; qty: number; total: number }[];
  credito: number;
  cobrosCredito: number;
  cuentasMesa: { count: number; total: number };
  /** Efectivo ya contado y bloqueado (null si aún no se registra). */
  contada: number | null;
  /** true = el conteo ya quedó bloqueado → mostrar el cuadre. */
  conteoBloqueado: boolean;
  errorConteo?: boolean;
}

export default function CierreClient(props: Props) {
  // Mientras el conteo NO esté bloqueado, lo primero (y único) que se ve es el
  // registro del efectivo, a ciegas: sin ver lo esperado ni las ventas. Así
  // nadie puede ver que "sobra" y bajar el número para quedarse el excedente.
  if (!props.conteoBloqueado) {
    return (
      <RegistrarConteo
        opening={props.resumen.caja.apertura}
        cuentasMesa={props.cuentasMesa}
        errorConteo={props.errorConteo}
      />
    );
  }
  return <CuadreWizard {...props} />;
}

/* ======================================================================== */
/*  VENTANA 1 · Registrar (y bloquear) el efectivo contado — a ciegas        */
/* ======================================================================== */
function RegistrarConteo({
  opening,
  cuentasMesa,
  errorConteo,
}: {
  opening: number;
  cuentasMesa: { count: number; total: number };
  errorConteo?: boolean;
}) {
  const [counted, setCounted] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const countedNum = Number(counted) || 0;
  const valido = counted.trim() !== "" && countedNum >= 0;

  function registrar() {
    startTransition(() => {
      void registrarConteoAction(countedNum);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Cuadrar caja" subtitle="Paso 1 de 3 · Cuenta el efectivo" />

      {errorConteo && (
        <Card className="border-coral/30 bg-coral/5 p-4">
          <p className="text-sm font-bold text-coral">
            No se pudo registrar el conteo. Intenta de nuevo.
          </p>
        </Card>
      )}

      {cuentasMesa.count > 0 && (
        <Card className="border-coral/30 bg-coral/5 p-4">
          <p className="text-sm font-bold text-coral">
            ⚠️ {cuentasMesa.count} cuenta{cuentasMesa.count === 1 ? "" : "s"} de mesa sin
            cobrar ({money(cuentasMesa.total)})
          </p>
          <p className="mt-0.5 text-xs opacity-70">
            Esa comida ya salió. Cóbralas o elimínalas en “Vender → Cuentas abiertas”
            antes de cerrar, o parecerá faltante.
          </p>
        </Card>
      )}

      <Card className="p-5">
        <p className="text-lg font-bold leading-tight">
          ¿Cuánto dinero hay en la caja ahora?
        </p>
        <p className="mt-1.5 text-sm opacity-70">
          Cuenta <span className="font-semibold">TODO</span> el efectivo físico que hay en
          la caja en este momento (billetes y monedas),{" "}
          <span className="font-semibold">incluida la base con la que abriste</span>.
        </p>
        <div className="mt-3 rounded-2xl bg-lav/60 px-3 py-2 text-xs">
          Tu caja inicial fue <span className="font-bold">{money(opening)}</span> — ese
          dinero también va incluido en el total.
        </div>
        <div className="mt-4">
          <Field label="Total contado en la caja">
            <Input
              inputMode="decimal"
              value={counted}
              onChange={(ev) => setCounted(ev.target.value)}
              placeholder="0.00"
              autoFocus
            />
          </Field>
        </div>
      </Card>

      <Button variant="accent" onClick={() => setOpen(true)} disabled={!valido}>
        Continuar
      </Button>
      <p className="text-center text-xs opacity-50">
        Al registrar el total no podrás cambiarlo. Si te equivocas, la jefa lo reinicia.
      </p>

      {/* Confirmación de bloqueo (irreversible para la encargada) */}
      <Modal open={open} onClose={() => !pending && setOpen(false)}>
        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-bold tracking-tight">¿Registrar el conteo?</h2>
          <div className="rounded-3xl bg-lav p-4 text-center">
            <p className="text-xs opacity-60">Dinero contado en la caja</p>
            <p className="text-3xl font-bold">{money(countedNum)}</p>
          </div>
          <p className="text-center text-xs opacity-60">
            Una vez registrado <span className="font-semibold">no podrás cambiarlo</span>.
            Solo la jefa puede reiniciarlo.
          </p>
          <Button variant="accent" onClick={registrar} disabled={pending}>
            {pending ? "Registrando…" : "Sí, registrar"}
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Volver a contar
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/* ======================================================================== */
/*  VENTANAS 2 y 3 · Cuadre (a color) y resumen final, con el conteo ya fijo  */
/* ======================================================================== */
function CuadreWizard({
  resumen,
  ventasDetalle,
  credito,
  cobrosCredito,
  cuentasMesa,
  contada,
}: Props) {
  const opening = Number(resumen.caja.apertura) || 0;
  const expected = Number(resumen.caja.esperada) || 0;
  const countedNum = Number(contada) || 0;

  const [step, setStep] = useState<"cuadre" | "resumen">("cuadre");
  const [floatStr, setFloatStr] = useState(opening ? String(opening) : "");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  const floatNum = Number(floatStr) || 0;
  const dif = countedNum - expected;
  const entrega = countedNum - floatNum;
  const costosTotal = resumen.gastos.total + resumen.egresos.total;

  function cerrar() {
    startTransition(() => {
      void cerrarTurnoAction(countedNum, floatNum, notes);
    });
  }

  /* ---------------------- VENTANA 3 · Resumen final --------------------- */
  if (step === "resumen") {
    return (
      <div className="flex flex-col gap-4">
        <PageTitle title="Resumen del cierre" subtitle="Paso 3 de 3 · Revisa y cierra" />

        <DescuadreBox dif={dif} />

        {/* Ventas */}
        <Card className="p-4">
          <p className="mb-1 text-sm font-semibold">Ventas del turno</p>
          <Row label="Total vendido" value={resumen.ventas.total} strong />
          <Sub label={`Efectivo · ${resumen.ventas.n} ventas`} value={resumen.ventas.efectivo} />
          {resumen.ventas.transferencia > 0 && (
            <Sub label="Transferencia" value={resumen.ventas.transferencia} />
          )}
          {resumen.ventas.otro > 0 && <Sub label="Otro" value={resumen.ventas.otro} />}
          {credito > 0 && (
            <Sub label="Crédito · por cobrar (no es efectivo)" value={credito} />
          )}
        </Card>

        {/* Caja (cifras duras) */}
        <Card className="p-4">
          <p className="mb-1 text-sm font-semibold">Caja</p>
          <Sub label="Caja inicial" value={opening} />
          {resumen.aportes > 0 && (
            <Sub label="+ Aportes (jefa / ingresos)" value={resumen.aportes} />
          )}
          <Sub label="− Costos del turno" value={costosTotal} />
          <div className="flex items-center justify-between border-t border-ink/10 py-1.5 pt-2 text-sm font-semibold">
            <span>= Debía haber en caja</span>
            <span>{money(expected)}</span>
          </div>
          <div className="flex items-center justify-between py-1.5 text-sm font-semibold">
            <span>Contaste</span>
            <span>{money(countedNum)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-ink/10 py-1.5 pt-2 text-sm">
            <span className="opacity-60">{difLabel(dif)}</span>
            <span className={`font-bold ${difTextClass(dif)}`}>{money(dif)}</span>
          </div>
        </Card>

        {/* Entrega de efectivo */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-3xl bg-sand p-4 text-center">
            <p className="text-xs opacity-60">Dejas en caja</p>
            <p className="text-xl font-bold">{money(floatNum)}</p>
          </div>
          <div className="rounded-3xl bg-lav p-4 text-center">
            <p className="text-xs opacity-60">Entregas a la jefa</p>
            <p className="text-xl font-bold">{money(entrega)}</p>
          </div>
        </div>

        <Button variant="accent" onClick={cerrar} disabled={pending}>
          {pending ? "Cerrando caja…" : "Cerrar caja"}
        </Button>
        <p className="text-center text-xs opacity-50">
          Al cerrar, todas las que trabajaron este turno saldrán de la sesión.
        </p>
        <Button variant="outline" onClick={() => setStep("cuadre")} disabled={pending}>
          Volver
        </Button>
      </div>
    );
  }

  /* --------------------- VENTANA 2 · Cuadre a color --------------------- */
  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Cuadre de caja"
        subtitle={`Paso 2 de 3${resumen.shift ? ` · ${resumen.shift}` : ""}`}
      />

      {cuentasMesa.count > 0 && (
        <Card className="border-coral/30 bg-coral/5 p-4">
          <p className="text-sm font-bold text-coral">
            ⚠️ {cuentasMesa.count} cuenta{cuentasMesa.count === 1 ? "" : "s"} de mesa sin
            cobrar ({money(cuentasMesa.total)})
          </p>
          <p className="mt-0.5 text-xs opacity-70">
            Esa comida ya salió. Cóbralas o elimínalas en “Vender → Cuentas abiertas”.
          </p>
        </Card>
      )}

      {/* Resultado del cuadre — el dato clave, a color */}
      <DescuadreBox dif={dif} />

      {/* Caja: esperada vs lo contado (bloqueado) */}
      <Card className="p-4">
        <p className="mb-1 text-sm font-semibold">Caja</p>
        <Sub label="Caja inicial" value={opening} />
        {resumen.aportes > 0 && (
          <Sub label="+ Aportes (jefa / ingresos)" value={resumen.aportes} />
        )}
        {cobrosCredito > 0 && (
          <Sub label="↳ incluye cobros de crédito" value={cobrosCredito} />
        )}
        <Sub label="− Costos del turno" value={costosTotal} />
        <div className="flex items-center justify-between border-t border-ink/10 py-1.5 pt-2 text-sm font-semibold">
          <span>= Debía haber en caja</span>
          <span>{money(expected)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between rounded-2xl bg-ink/[0.03] px-3 py-2 text-sm">
          <span className="font-semibold">🔒 Contaste (registrado)</span>
          <span className="font-bold">{money(countedNum)}</span>
        </div>
      </Card>

      {/* Resumen del turno */}
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
          {credito > 0 && (
            <Sub label="Crédito · por cobrar (no es efectivo)" value={credito} />
          )}
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
      </Card>

      {/* ¿Qué vendiste? */}
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

      {/* Cuánto deja + entrega */}
      <Card className="p-4">
        <Field label="¿Cuánta caja dejas para el próximo turno?">
          <Input
            inputMode="decimal"
            value={floatStr}
            onChange={(ev) => setFloatStr(ev.target.value)}
            placeholder={String(opening)}
          />
        </Field>
        <div className="mt-3 rounded-3xl bg-lav p-4 text-center">
          <p className="text-xs opacity-60">Efectivo a entregar a la jefa</p>
          <p className="text-2xl font-bold">{money(entrega)}</p>
          <p className="text-xs opacity-50">
            Contaste {money(countedNum)} − caja que dejas {money(floatNum)}
          </p>
        </div>
      </Card>

      <Field label="Nota (opcional)">
        <Input
          value={notes}
          onChange={(ev) => setNotes(ev.target.value)}
          placeholder="Ej. faltó cambio, propinas aparte…"
        />
      </Field>

      <Button variant="accent" onClick={() => setStep("resumen")}>
        Confirmar cierre de caja
      </Button>
    </div>
  );
}

/* ----------------------------- helpers UI ------------------------------ */

/** Resultado del cuadre en un solo cuadro, a color:
 *  azul = exacto · verde = sobra (excedente) · rojo = falta (descuadre). */
function DescuadreBox({ dif }: { dif: number }) {
  const cuadra = Math.abs(dif) < 0.005;
  const sobra = dif > 0.005;
  const box = cuadra
    ? "bg-blue/10 border border-blue/40"
    : sobra
      ? "bg-mint border border-teal/40"
      : "bg-coral/10 border border-coral/40";
  const titulo = cuadra ? "Caja exacta" : sobra ? "Sobra dinero" : "Falta dinero";
  const sub = cuadra
    ? "La caja cuadra perfecto"
    : sobra
      ? "Hay un excedente en la caja"
      : "Hay un faltante en la caja";

  return (
    <div className={`rounded-3xl p-5 text-center ${box}`}>
      <p className={`text-sm font-semibold ${difTextClass(dif)}`}>{titulo}</p>
      <p className={`mt-1 text-4xl font-bold ${difTextClass(dif)}`}>{money(dif)}</p>
      <p className="mt-1 text-xs opacity-70">{sub}</p>
    </div>
  );
}

function difTextClass(dif: number): string {
  if (Math.abs(dif) < 0.005) return "text-blue";
  return dif > 0 ? "text-teal" : "text-coral";
}

function difLabel(dif: number): string {
  if (Math.abs(dif) < 0.005) return "Cuadre (exacto)";
  return dif > 0 ? "Excedente" : "Faltante";
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

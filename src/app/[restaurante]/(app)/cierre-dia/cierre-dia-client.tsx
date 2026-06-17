"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, PageTitle } from "@/components/ui";
import { registrarMermaInsumosAction } from "../admin/actions";
import { cerrarDiaAction } from "../../actions";
import type { DaySummary } from "@/lib/reports";

export interface WizardTurno {
  shift: string;
  responsable: string | null;
  status: string;
  esperada: number;
  contada: number | null;
  descuadre: number | null;
}
interface Producto {
  id: string;
  name: string;
  unit: string | null;
  cost: number;
  stock: number;
}

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

const STEPS = ["Turnos", "Dañados", "Cerrar"];

export default function CierreDiaWizard({
  slug,
  date,
  closed,
  turnos,
  productos,
  summary,
}: {
  slug: string;
  date: string;
  closed: boolean;
  turnos: WizardTurno[];
  productos: Producto[];
  summary: DaySummary;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [danadoQty, setDanadoQty] = useState<Record<string, string>>({});
  const [danadoReason, setDanadoReason] = useState("");
  const [danadoQuery, setDanadoQuery] = useState("");
  const [closeMsg, setCloseMsg] = useState<string | null>(null);
  const [pendingClose, startClose] = useTransition();

  const turnosAbiertos = turnos.filter((t) => t.status !== "closed").length;
  const danadosTotal = productos.reduce(
    (s, p) => s + (Number(danadoQty[p.id]) || 0) * p.cost,
    0,
  );
  const q = danadoQuery.trim().toLowerCase();
  const productosFiltrados = q
    ? productos.filter((p) => p.name.toLowerCase().includes(q))
    : productos;

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  function cerrarDia() {
    setCloseMsg(null);
    const danados = productos
      .map((p) => ({
        ingredientId: p.id,
        qty: Number(danadoQty[p.id]) || 0,
        reason: danadoReason.trim() || null,
      }))
      .filter((x) => x.qty > 0);
    startClose(async () => {
      // Primero da de baja los productos dañados / perdidos (van a merma).
      if (danados.length > 0) {
        const rm = await registrarMermaInsumosAction(date, danados);
        if (rm?.error) {
          setCloseMsg(rm.error);
          return;
        }
      }
      // El granel ya no declara merma manual: se cierra sin merma, así todo el
      // pool cocinado se reparte entre los platos que sí se vendieron.
      const r = await cerrarDiaAction({});
      if (r?.error) setCloseMsg(r.error);
      else router.refresh();
    });
  }

  // ----- Día ya cerrado -----
  if (closed) {
    return (
      <div className="flex flex-col gap-4">
        <PageTitle title="Día cerrado" subtitle={`Costos calculados · ${date}`} />
        <div className="rounded-3xl bg-mint p-5 text-center">
          <p className="text-sm opacity-70">Utilidad del día</p>
          <p className="text-3xl font-bold">{money(summary.utilidad)}</p>
        </div>
        <ResumenNumeros summary={summary} />
        <Link
          href={`/${slug}/resumen`}
          className="rounded-full bg-ink px-5 py-3 text-center text-sm font-semibold text-white"
        >
          Ver resumen del día
        </Link>
        <Link href={`/${slug}/admin`} className="text-center text-sm font-medium underline">
          Volver a administrar
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Cerrar el día" subtitle="Revisa los turnos y los daños, y cuadra el día" />
      <Stepper step={step} onPick={setStep} />

      {/* ---------- PASO 1 · TURNOS ---------- */}
      {step === 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm opacity-70">
            Antes de cerrar costos, la caja de cada turno debe estar cerrada (cada chica cierra la
            suya en su pantalla).
          </p>
          {turnosAbiertos > 0 && (
            <div className="rounded-2xl bg-peach p-4 text-sm">
              ⚠️ Hay {turnosAbiertos} turno(s) sin cerrar. Pídeles cerrar su caja, o puedes seguir y
              cerrar el día igual.
            </div>
          )}
          {turnos.length === 0 ? (
            <p className="rounded-2xl bg-ink/[0.03] p-4 text-sm opacity-60">
              No hubo turnos registrados hoy.
            </p>
          ) : (
            <Card className="p-0">
              {turnos.map((t, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between border-b border-ink/5 px-4 py-3 last:border-0"
                >
                  <div>
                    <p className="text-sm font-semibold">{t.shift}</p>
                    <p className="text-xs opacity-50">{t.responsable ?? "—"}</p>
                  </div>
                  <div className="text-right">
                    {t.status === "closed" ? (
                      <>
                        <span className="rounded-full bg-mint px-3 py-1 text-xs font-semibold">
                          cerrado
                        </span>
                        {t.descuadre != null && Math.abs(t.descuadre) > 0.005 && (
                          <p className="mt-1 text-xs text-coral">desfase {money(t.descuadre)}</p>
                        )}
                      </>
                    ) : (
                      <span className="rounded-full bg-peach px-3 py-1 text-xs font-semibold">
                        abierto
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {/* ---------- PASO 2 · DAÑADOS ---------- */}
      {step === 1 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm opacity-70">
            ¿Algún producto se <b>dañó o se perdió</b> hoy y ya no sirve (un tomate podrido, una
            presa que no aguanta mañana, una cola rota)? Márcalo: baja del inventario como{" "}
            <b>merma</b>. Es por producto, no por plato. Lo vendido ya se descontó solo.
          </p>
          <input
            value={danadoQuery}
            onChange={(e) => setDanadoQuery(e.target.value)}
            placeholder="Buscar producto…"
            className="w-full rounded-xl border border-ink/15 px-3 py-2 text-sm outline-none focus:border-ink/40"
          />
          {danadosTotal > 0.005 && (
            <div className="rounded-2xl bg-coral p-3 text-center text-white">
              <p className="text-xs text-white/70">Pérdida por daño</p>
              <p className="text-xl font-bold">{money(danadosTotal)}</p>
            </div>
          )}
          {productos.length === 0 ? (
            <p className="rounded-2xl bg-ink/[0.03] p-4 text-sm opacity-60">
              No hay productos en el inventario.
            </p>
          ) : (
            <Card className="max-h-[22rem] overflow-y-auto p-0">
              {productosFiltrados.map((p) => {
                const v = danadoQty[p.id] ?? "";
                const active = Number(v) > 0;
                return (
                  <div
                    key={p.id}
                    className="flex items-center border-t border-ink/5 px-4 py-2.5 text-sm first:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className={`truncate font-medium ${active ? "text-coral" : ""}`}>
                        {p.name}
                      </p>
                      <p className="text-[11px] opacity-50">
                        stock {p.stock} · {money(p.cost)} c/u
                      </p>
                    </div>
                    <input
                      inputMode="decimal"
                      value={v}
                      onChange={(e) =>
                        setDanadoQty((m) => ({
                          ...m,
                          [p.id]: e.target.value.replace(/[^\d.]/g, ""),
                        }))
                      }
                      placeholder="0"
                      className="w-20 rounded-xl border border-ink/15 px-2 py-1.5 text-right outline-none focus:border-ink/40"
                    />
                  </div>
                );
              })}
            </Card>
          )}
          <input
            value={danadoReason}
            onChange={(e) => setDanadoReason(e.target.value)}
            placeholder="Motivo (opcional): se dañó, se pudrió…"
            className="w-full rounded-xl border border-ink/15 px-3 py-2 text-sm outline-none focus:border-ink/40"
          />
        </div>
      )}

      {/* ---------- PASO 3 · CERRAR ---------- */}
      {step === 2 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm opacity-70">
            Revisa el cuadre del día y ciérralo. Esto calcula el costo real de cada plato y guarda el
            historial.
          </p>
          <ResumenNumeros summary={summary} />
          {danadosTotal > 0 && (
            <p className="text-center text-xs opacity-60">
              Productos dañados: se darán de baja {money(danadosTotal)} como merma.
            </p>
          )}
          <Button variant="accent" onClick={cerrarDia} disabled={pendingClose}>
            {pendingClose ? "Cerrando…" : "Cerrar el día"}
          </Button>
          {closeMsg && <p className="text-center text-sm text-coral">{closeMsg}</p>}
        </div>
      )}

      {/* ---------- NAVEGACIÓN ---------- */}
      <div className="flex items-center gap-2">
        {step > 0 && (
          <Button variant="outline" onClick={back} disabled={pendingClose}>
            ← Atrás
          </Button>
        )}
        {step < STEPS.length - 1 && <Button onClick={next}>Siguiente →</Button>}
      </div>
    </div>
  );
}

function Stepper({ step, onPick }: { step: number; onPick: (s: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((label, i) => {
        const state = i < step ? "done" : i === step ? "now" : "todo";
        return (
          <button
            key={label}
            onClick={() => i <= step && onPick(i)}
            className={`flex-1 rounded-full px-2 py-1.5 text-center text-xs font-semibold ${
              state === "now"
                ? "bg-ink text-white"
                : state === "done"
                  ? "bg-mint"
                  : "bg-ink/5 opacity-50"
            }`}
          >
            {i + 1}. {label}
          </button>
        );
      })}
    </div>
  );
}

// Cuadre del día como un mini estado de resultados: ventas − costo de lo vendido
// = ganancia bruta; menos gastos y fijos = utilidad. Así se ve claro qué se
// resta y cuánto margen deja el día.
function ResumenNumeros({ summary }: { summary: DaySummary }) {
  const costoVendido = summary.insumos.total + summary.productos.total;
  const bruto = summary.ventas - costoVendido;
  const margenPct = summary.ventas > 0 ? (bruto / summary.ventas) * 100 : 0;
  return (
    <Card className="p-4">
      <Linea label="Ventas del día" value={summary.ventas} strong />

      <p className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide opacity-40">
        Costo de lo vendido
      </p>
      <Linea label="Insumos cocinados" value={-summary.insumos.total} sub />
      <Linea label="Productos vendidos" value={-summary.productos.total} sub />
      <div className="mt-1 flex items-center justify-between border-t border-ink/10 pt-1.5">
        <span className="text-sm font-medium">Ganancia bruta</span>
        <span className="text-sm font-semibold">
          {money(bruto)} <span className="text-xs opacity-50">· {margenPct.toFixed(0)}%</span>
        </span>
      </div>

      <p className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide opacity-40">
        Gastos del día
      </p>
      <Linea label="Gastos (servicios, consumibles)" value={-summary.gastos.total} sub />
      <Linea label="Costos fijos (prorrateo)" value={-summary.fijos.total} sub />

      <div className="mt-2 flex items-center justify-between border-t border-ink/10 pt-2">
        <span className="text-sm font-semibold">Utilidad del día</span>
        <span className="text-lg font-bold">{money(summary.utilidad)}</span>
      </div>
    </Card>
  );
}

function Linea({
  label,
  value,
  strong,
  sub,
}: {
  label: string;
  value: number;
  strong?: boolean;
  sub?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className={sub ? "pl-3 opacity-60" : "opacity-60"}>{label}</span>
      <span className={strong ? "font-bold" : "tabular-nums"}>{money(value)}</span>
    </div>
  );
}

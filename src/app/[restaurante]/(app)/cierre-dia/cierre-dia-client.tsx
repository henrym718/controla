"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, PageTitle } from "@/components/ui";
import { registrarConteoAction, registrarMermaPlatosAction } from "../admin/actions";
import { cerrarDiaAction } from "../../actions";
import type { DaySummary } from "@/lib/reports";
import type { ConteoEstado } from "../conteo/conteo-client";

export interface WizardTurno {
  shift: string;
  responsable: string | null;
  status: string;
  esperada: number;
  contada: number | null;
  descuadre: number | null;
}
interface Pool {
  ingredientId: string;
  name: string;
  poolCost: number;
}
interface Plato {
  id: string;
  name: string;
}

const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
const qtyStr = (n: number | null) => (n == null ? "—" : String(Number(n)));

const STEPS = ["Turnos", "Conteo", "Merma", "Platos", "Cerrar"];
const MERMA_PRESETS = [
  { label: "Nada", pct: 0 },
  { label: "Poco", pct: 10 },
  { label: "Un cuarto", pct: 25 },
  { label: "La mitad", pct: 50 },
];

export default function CierreDiaWizard({
  slug,
  date,
  closed,
  turnos,
  conteo,
  pools,
  platos,
  summary,
}: {
  slug: string;
  date: string;
  closed: boolean;
  turnos: WizardTurno[];
  conteo: ConteoEstado;
  pools: Pool[];
  platos: Plato[];
  summary: DaySummary;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [conteoDone, setConteoDone] = useState(conteo.locked);
  const [conteoMsg, setConteoMsg] = useState<string | null>(null);
  const [merma, setMerma] = useState<Record<string, number>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [platosLost, setPlatosLost] = useState<Record<string, string>>({});
  const [closeMsg, setCloseMsg] = useState<string | null>(null);
  const [pendingConteo, startConteo] = useTransition();
  const [pendingClose, startClose] = useTransition();

  const turnosAbiertos = turnos.filter((t) => t.status !== "closed").length;
  const costos =
    summary.insumos.total + summary.productos.total + summary.gastos.total + summary.fijos.total;
  const mermaPreview = pools.reduce(
    (s, p) => s + p.poolCost * ((merma[p.ingredientId] ?? 0) / 100),
    0,
  );

  const faltante = useMemo(() => {
    if (conteo.locked) {
      return conteo.items.reduce(
        (s, i) => s + (i.diff != null && i.diff < 0 ? Math.abs(Number(i.diff_cost)) : 0),
        0,
      );
    }
    return conteo.items.reduce((s, i) => {
      const raw = counts[i.ingredient_id];
      if (raw === undefined || raw === "") return s;
      const d = (Number(raw) || 0) - Number(i.expected);
      return s + (d < 0 ? Math.abs(d) * Number(i.unit_cost) : 0);
    }, 0);
  }, [conteo, counts]);

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  function guardarConteo() {
    setConteoMsg(null);
    const payload = conteo.items.map((i) => {
      const raw = counts[i.ingredient_id];
      const countedQty = raw === undefined || raw === "" ? Number(i.expected) : Number(raw) || 0;
      return { ingredientId: i.ingredient_id, countedQty };
    });
    startConteo(async () => {
      const r = await registrarConteoAction(date, payload);
      if (r.error) setConteoMsg(r.error);
      else {
        setConteoDone(true);
        next();
      }
    });
  }

  function cerrarDia() {
    setCloseMsg(null);
    const map: Record<string, number> = {};
    for (const p of pools) map[p.ingredientId] = merma[p.ingredientId] ?? 0;
    const lost = platos
      .map((p) => ({ dishId: p.id, qty: Number(platosLost[p.id]) || 0 }))
      .filter((x) => x.qty > 0);
    startClose(async () => {
      // Primero la merma de platos preparados (baja la proteína sobrante).
      if (lost.length > 0) {
        const rm = await registrarMermaPlatosAction(date, lost);
        if (rm?.error) {
          setCloseMsg(rm.error);
          return;
        }
      }
      const r = await cerrarDiaAction(map);
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
        <ResumenNumeros summary={summary} costos={costos} faltante={faltante} />
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
      <PageTitle title="Cerrar el día" subtitle="Conteo, merma y costos en un solo flujo" />
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

      {/* ---------- PASO 2 · CONTEO ---------- */}
      {step === 1 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm opacity-70">
            Auditoría anti-robo, <b>opcional</b>. No toca los costos ni el pool: solo cuentas el
            stock físico que se puede contar (aguas, colas, carnes, presas). Si cuentas <b>menos</b>{" "}
            de lo que el sistema esperaba, esa diferencia es plata perdida. Si no quieres auditar,
            toca «Saltar».
          </p>
          <div className={`rounded-3xl p-4 text-white ${faltante > 0.005 ? "bg-coral" : "bg-ink"}`}>
            <p className="text-xs text-white/70">
              {conteoDone ? "Faltante registrado" : "Faltante en curso"}
            </p>
            <p className="text-2xl font-bold">{money(faltante)}</p>
          </div>

          {conteo.items.length === 0 ? (
            <p className="rounded-2xl bg-ink/[0.03] p-4 text-sm opacity-60">
              No hay productos contables que contar.
            </p>
          ) : conteoDone ? (
            <Card className="p-0">
              {conteo.items.map((i) => {
                const d = Number(i.diff ?? 0);
                const cuadra = Math.abs(d) < 0.0001;
                return (
                  <div
                    key={i.ingredient_id}
                    className="flex items-center border-t border-ink/5 px-4 py-2 text-sm first:border-0"
                  >
                    <span className="flex-1 font-medium">{i.name}</span>
                    <span className="w-16 text-right opacity-60">{qtyStr(i.expected)}</span>
                    <span className="w-16 text-right">{qtyStr(i.counted)}</span>
                    <span
                      className={`w-16 text-right font-semibold ${
                        cuadra ? "opacity-40" : d < 0 ? "text-coral" : "text-teal"
                      }`}
                    >
                      {cuadra ? "—" : `${d > 0 ? "+" : ""}${d}`}
                    </span>
                  </div>
                );
              })}
            </Card>
          ) : (
            <Card className="p-0">
              <div className="flex bg-ink/5 px-4 py-2 text-xs font-semibold opacity-60">
                <span className="flex-1">Producto</span>
                <span className="w-20 text-right">Debería</span>
                <span className="w-24 text-right">Contado</span>
              </div>
              {conteo.items.map((i) => {
                const raw = counts[i.ingredient_id] ?? "";
                const d = raw === "" ? null : (Number(raw) || 0) - Number(i.expected);
                return (
                  <div
                    key={i.ingredient_id}
                    className="flex items-center border-t border-ink/5 px-4 py-2 text-sm"
                  >
                    <span className="flex-1 font-medium">
                      {i.name}
                      {d != null && d !== 0 && (
                        <span
                          className={`ml-2 text-[11px] font-semibold ${
                            d < 0 ? "text-coral" : "text-teal"
                          }`}
                        >
                          {d > 0 ? `+${d}` : d}
                        </span>
                      )}
                    </span>
                    <span className="w-20 text-right opacity-60">{qtyStr(i.expected)}</span>
                    <input
                      inputMode="decimal"
                      value={raw}
                      onChange={(e) =>
                        setCounts((c) => ({ ...c, [i.ingredient_id]: e.target.value }))
                      }
                      placeholder={qtyStr(i.expected)}
                      className="ml-2 w-20 rounded-xl border border-ink/15 px-2 py-1.5 text-right text-sm outline-none focus:border-ink/40"
                    />
                  </div>
                );
              })}
            </Card>
          )}
          {conteoDone && <p className="text-center text-xs text-teal">✓ Conteo guardado.</p>}
          {conteoMsg && <p className="text-center text-sm text-coral">{conteoMsg}</p>}
        </div>
      )}

      {/* ---------- PASO 3 · MERMA ---------- */}
      {step === 2 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm opacity-70">
            De lo que cocinaste a granel, ¿cuánto <b>sobró y se botó</b>? Eso es pérdida; el resto se
            reparte entre los platos vendidos. Si no sobró nada, déjalo en «Nada».
          </p>
          {pools.length === 0 && (
            <p className="rounded-2xl bg-ink/[0.03] p-4 text-sm opacity-60">
              No hubo producción a granel hoy.
            </p>
          )}
          {pools.map((p) => {
            const cur = merma[p.ingredientId] ?? 0;
            const perdido = p.poolCost * (cur / 100);
            const reparte = p.poolCost - perdido;
            const showCustom = custom[p.ingredientId] != null;
            return (
              <Card key={p.ingredientId} className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-xs opacity-60">preparaste {money(p.poolCost)}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {MERMA_PRESETS.map((opt) => {
                    const active = !showCustom && cur === opt.pct;
                    const tone = opt.pct === 0 ? "bg-mint" : "bg-ink text-white";
                    return (
                      <button
                        key={opt.pct}
                        onClick={() => {
                          setMerma((m) => ({ ...m, [p.ingredientId]: opt.pct }));
                          setCustom((c) => {
                            const n = { ...c };
                            delete n[p.ingredientId];
                            return n;
                          });
                        }}
                        className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                          active ? tone : "border border-ink/15"
                        }`}
                      >
                        {opt.label}
                        {opt.pct > 0 ? ` · ${opt.pct}%` : ""}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setCustom((c) => ({ ...c, [p.ingredientId]: String(cur) }))}
                    className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                      showCustom ? "bg-ink text-white" : "border border-ink/15"
                    }`}
                  >
                    Otro
                  </button>
                </div>
                {showCustom && (
                  <label className="flex items-center gap-2 text-sm">
                    Sobró
                    <input
                      inputMode="decimal"
                      value={custom[p.ingredientId]}
                      onChange={(e) => {
                        const v = e.target.value;
                        setCustom((c) => ({ ...c, [p.ingredientId]: v }));
                        setMerma((m) => ({
                          ...m,
                          [p.ingredientId]: Math.min(100, Math.max(0, Number(v) || 0)),
                        }));
                      }}
                      placeholder="0"
                      className="w-20 rounded-xl border border-ink/15 px-2 py-1 text-right outline-none focus:border-ink/40"
                    />
                    %
                  </label>
                )}
                <p className="text-xs opacity-70">
                  {cur > 0 ? `Se pierde ${money(perdido)}. ` : "No se pierde nada. "}
                  Se reparte {money(reparte)} entre los platos vendidos.
                </p>
              </Card>
            );
          })}
        </div>
      )}

      {/* ---------- PASO 4 · PLATOS PERDIDOS ---------- */}
      {step === 3 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm opacity-70">
            ¿Algún plato que <b>cocinaste</b> hoy y <b>no se vendió</b>? Pon cuántos sobraron: se
            descuenta su proteína del inventario como pérdida. Lo vendido ya se descontó solo.
          </p>
          {platos.length === 0 ? (
            <p className="rounded-2xl bg-ink/[0.03] p-4 text-sm opacity-60">
              No hubo platos en el menú de hoy.
            </p>
          ) : (
            <Card className="p-0">
              {platos.map((p) => {
                const v = platosLost[p.id] ?? "";
                const active = Number(v) > 0;
                return (
                  <div
                    key={p.id}
                    className="flex items-center border-t border-ink/5 px-4 py-2.5 text-sm first:border-0"
                  >
                    <span className={`flex-1 font-medium ${active ? "text-coral" : ""}`}>
                      {p.name}
                    </span>
                    <input
                      inputMode="numeric"
                      value={v}
                      onChange={(e) =>
                        setPlatosLost((m) => ({
                          ...m,
                          [p.id]: e.target.value.replace(/[^\d]/g, ""),
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
          <p className="text-[11px] opacity-50">
            Solo baja insumos contables (presa, huevo) de la receta. El granel sobrante va en el paso
            de merma.
          </p>
        </div>
      )}

      {/* ---------- PASO 5 · CERRAR ---------- */}
      {step === 4 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm opacity-70">
            Revisa el resumen y cierra el día. Esto calcula el costo real de cada plato y guarda el
            historial.
          </p>
          <ResumenNumeros summary={summary} costos={costos} faltante={faltante} />
          {mermaPreview > 0 && (
            <p className="text-center text-xs opacity-60">
              Merma declarada: se perderán {money(mermaPreview)} de lo cocinado a granel.
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
          <Button variant="outline" onClick={back} disabled={pendingConteo || pendingClose}>
            ← Atrás
          </Button>
        )}
        {step === 1 && !conteoDone && conteo.items.length > 0 ? (
          <>
            <Button onClick={guardarConteo} disabled={pendingConteo}>
              {pendingConteo ? "Guardando…" : "Guardar conteo y seguir"}
            </Button>
            <button
              onClick={next}
              className="shrink-0 px-3 text-sm font-medium opacity-50 underline"
            >
              Saltar
            </button>
          </>
        ) : step < STEPS.length - 1 ? (
          <Button onClick={next}>Siguiente →</Button>
        ) : null}
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

function ResumenNumeros({
  summary,
  costos,
  faltante,
}: {
  summary: DaySummary;
  costos: number;
  faltante: number;
}) {
  return (
    <Card className="p-4">
      <Linea label="Ventas" value={summary.ventas} strong />
      <Linea label="Insumos cocinados" value={-summary.insumos.total} />
      <Linea label="Productos vendidos" value={-summary.productos.total} />
      <Linea label="Gastos" value={-summary.gastos.total} />
      <Linea label="Costos fijos (día)" value={-summary.fijos.total} />
      <div className="mt-1 flex items-center justify-between border-t border-ink/10 pt-2">
        <span className="text-sm font-semibold">Utilidad del día</span>
        <span className="text-lg font-bold">{money(summary.utilidad)}</span>
      </div>
      {faltante > 0.005 && (
        <p className="mt-2 text-xs text-coral">Faltante en conteo: {money(faltante)}</p>
      )}
      <p className="mt-1 text-[11px] opacity-50">Costos totales del día: {money(costos)}</p>
    </Card>
  );
}

function Linea({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="opacity-60">{label}</span>
      <span className={strong ? "font-bold" : ""}>{money(value)}</span>
    </div>
  );
}

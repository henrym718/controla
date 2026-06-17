"use client";

import { useState } from "react";
import { DayNav } from "@/components/day-nav";
import { Card } from "@/components/ui";
import type { DaySummary } from "@/lib/reports";

const money = (n: number) => `$${n.toFixed(2)}`;

export default function ResumenClient({
  slug,
  today,
  initial,
}: {
  slug: string;
  today: string;
  initial: DaySummary;
}) {
  const [date, setDate] = useState(today);
  const [s, setS] = useState<DaySummary>(initial);
  const [loading, setLoading] = useState(false);

  async function change(d: string) {
    setDate(d);
    setLoading(true);
    try {
      const res = await fetch(`/api/resumen?date=${d}`);
      if (res.ok) setS(await res.json());
    } finally {
      setLoading(false);
    }
  }

  const costosTotal = s.insumos.total + s.productos.total + s.gastos.total + s.fijos.total;
  const row = "flex items-center justify-between py-2 text-sm border-b border-ink/5 last:border-0";
  const sub = "flex items-center justify-between py-1 text-xs opacity-70";

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">Resumen diario</h1>
      <DayNav value={date} today={today} onChange={change} />

      {s.closed ? (
        <div className="rounded-2xl bg-mint px-4 py-2 text-center text-sm font-semibold">
          ✓ Día cerrado · costos ya calculados
        </div>
      ) : (
        <div className="rounded-2xl bg-ink/5 px-4 py-2 text-center text-xs opacity-60">
          Día en curso · la merma y el costo por plato se calculan al cerrar el día
        </div>
      )}

      <div className={loading ? "pointer-events-none opacity-50 transition" : "transition"}>
        <div className="flex flex-col gap-4">
          {/* Utilidad grande */}
          <div className="relative overflow-hidden rounded-[28px] bg-ink p-6 text-white">
            <span className="blob absolute -right-6 -top-8 h-24 w-24 bg-teal/40" />
            <p className="relative text-xs font-medium text-white/60">Utilidad del día</p>
            <p className={`relative text-4xl font-bold ${s.utilidad >= 0 ? "text-teal" : "text-coral"}`}>
              {money(s.utilidad)}
            </p>
            <p className="relative mt-1 text-xs text-white/50">
              Ventas {money(s.ventas)} − costos {money(costosTotal)}
            </p>
          </div>

          {/* Insumos cocinados (pool del día) */}
          <Card>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Insumos cocinados (pool del día)</p>
              <span className="font-bold">{money(s.insumos.total)}</span>
            </div>
            <div className="mt-1">
              {s.insumos.items.map((i) => (
                <div key={i.name} className={sub}>
                  <span>
                    {i.name} {i.granel && <span className="opacity-50">· granel</span>}
                  </span>
                  <span>{money(i.cost)}</span>
                </div>
              ))}
              {s.insumos.items.length === 0 && <p className="py-1 text-xs opacity-50">Sin producción.</p>}
            </div>
          </Card>

          {/* Costo de productos (bebidas, desechables) */}
          <Card>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Costo de productos (bebidas, desechables)</p>
              <span className="font-bold">{money(s.productos.total)}</span>
            </div>
            <div className="mt-1">
              {s.productos.items.map((i) => (
                <div key={i.name} className={sub}>
                  <span>{i.name}</span>
                  <span>{money(i.cost)}</span>
                </div>
              ))}
              {s.productos.items.length === 0 && (
                <p className="py-1 text-xs opacity-50">Sin productos vendidos registrados.</p>
              )}
            </div>
          </Card>

          {/* Compras de inventario (entró a stock; informativo, no baja la utilidad) */}
          <Card>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Compras de inventario (entró a stock)</p>
              <span className="font-bold">{money(s.compras.total)}</span>
            </div>
            <div className="mt-1">
              {s.compras.items.map((i) => (
                <div key={i.name} className={sub}>
                  <span>
                    {i.name}{" "}
                    <span className="opacity-50">
                      · {i.qty}
                      {i.unit ? ` ${i.unit}` : ""}
                    </span>
                  </span>
                  <span>{money(i.cost)}</span>
                </div>
              ))}
              {s.compras.items.length === 0 && (
                <p className="py-1 text-xs opacity-50">Sin compras de inventario registradas.</p>
              )}
            </div>
            <p className="mt-1 text-[11px] opacity-50">
              No baja la utilidad: es dinero que se convierte en stock.
            </p>
          </Card>

          {/* Gastos del día (servilletas, escoba, gas, servicios) */}
          <Card>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Gastos del día</p>
              <span className="font-bold">{money(s.gastos.total)}</span>
            </div>
            <div className="mt-1">
              {s.gastos.items.map((i) => (
                <div key={i.name} className={sub}>
                  <span>{i.name}</span>
                  <span>{money(i.cost)}</span>
                </div>
              ))}
              {s.gastos.items.length === 0 && (
                <p className="py-1 text-xs opacity-50">Sin gastos registrados.</p>
              )}
            </div>
          </Card>

          {/* Costos fijos prorrateados al día */}
          <Card>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Costos fijos del día (prorrateados)</p>
              <span className="font-bold">{money(s.fijos.total)}</span>
            </div>
            <div className="mt-1">
              <div className={sub}><span>Operativo (sueldos, servicios)</span><span>{money(s.fijos.operativo)}</span></div>
              <div className={sub}><span>Administrativo (arriendo, internet)</span><span>{money(s.fijos.administrativo)}</span></div>
              <div className={sub}><span>Financiero (préstamos)</span><span>{money(s.fijos.financiero)}</span></div>
            </div>
          </Card>

          {/* Consumo de empleadas (informativo; ya dentro de los costos) */}
          {s.empleadas.n > 0 && (
            <Card className="bg-sand/40">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Consumo de empleadas</p>
                <span className="font-bold">{money(s.empleadas.total)}</span>
              </div>
              <div className="mt-1">
                {s.empleadas.items.map((i, idx) => (
                  <div key={idx} className={sub}>
                    <span>
                      {i.name} · {i.persona}
                    </span>
                    <span>{money(i.cost)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[11px] opacity-50">
                Comida del personal (gratis). Ya está dentro de los costos de arriba; se muestra para control.
              </p>
            </Card>
          )}

          {/* Análisis financiero */}
          <Card>
            <p className="mb-1 text-sm font-semibold">Análisis del día</p>
            <div className={row}><span>Ventas</span><span className="font-semibold text-teal">{money(s.ventas)}</span></div>
            <div className={row}><span>− Costo del pool (insumos)</span><span>{money(s.insumos.total)}</span></div>
            <div className={row}><span>− Costo de productos</span><span>{money(s.productos.total)}</span></div>
            <div className={row}><span>− Gastos del día</span><span>{money(s.gastos.total)}</span></div>
            <div className={row}><span>− Costos fijos del día</span><span>{money(s.fijos.total)}</span></div>
            <div className={row}>
              <span className="font-bold">= Utilidad del día</span>
              <span className={`font-bold ${s.utilidad >= 0 ? "text-teal" : "text-coral"}`}>{money(s.utilidad)}</span>
            </div>
            <div className="flex items-center justify-between pt-2 text-sm">
              <span className="opacity-60">Merma (pérdida del día)</span>
              {s.merma == null ? (
                <span className="rounded-full bg-sand px-3 py-1 text-xs font-semibold">Pendiente de cierre</span>
              ) : (
                <span className="font-semibold text-coral">{money(s.merma)}</span>
              )}
            </div>
          </Card>

          {/* Caja del día / cuadre */}
          <Card>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Caja del día</p>
              <span className="font-bold">{money(s.caja.esperada)}</span>
            </div>
            <div className="mt-1">
              <div className={sub}><span>Apertura</span><span>{money(s.caja.apertura)}</span></div>
              <div className={sub}><span>+ Ventas en efectivo</span><span>{money(s.caja.ventasEfectivo)}</span></div>
              <div className={sub}><span>+ Aportes (jefa / ingresos)</span><span>{money(s.caja.aportes)}</span></div>
              <div className={sub}><span>− Egresos (gastos, compras, retiros)</span><span>{money(s.caja.egresos)}</span></div>
              <div className="flex items-center justify-between py-1 text-xs font-semibold">
                <span>= Caja esperada</span><span>{money(s.caja.esperada)}</span>
              </div>
            </div>

            {s.caja.turnos.length > 0 && (
              <div className="mt-2 border-t border-ink/5 pt-2">
                {s.caja.turnos.map((t, idx) => (
                  <div key={idx} className={sub}>
                    <span>{t.shift}{t.cerrado ? "" : " · abierto"}</span>
                    <span>
                      {t.contada != null
                        ? `contó ${money(t.contada)} · ${t.descuadre != null && t.descuadre >= 0 ? "+" : ""}${money(t.descuadre ?? 0)}`
                        : `esperada ${money(t.esperada)}`}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {s.caja.descuadre != null && (
              <div className="flex items-center justify-between pt-2 text-sm">
                <span className="opacity-60">Descuadre del día</span>
                <span className={`font-semibold ${s.caja.descuadre >= 0 ? "text-teal" : "text-coral"}`}>
                  {money(s.caja.descuadre)}
                </span>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

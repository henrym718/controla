import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { eachDate, parseLocal } from "@/lib/range";
import { businessDate } from "@/lib/shifts";

type Db = SupabaseClient<Database>;

const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

// ===========================================================================
//  REPORTE DEL DÍA (un solo día)
// ===========================================================================
export interface DishLine {
  dishId: string | null;
  name: string;
  qty: number;
  revenue: number;
  unitCost: number | null;
  cost: number | null;
  margin: number | null;
}
export interface DayReport {
  date: string;
  ventas: number;
  costoDia: number;
  margenDia: number;
  mermaGranel: number;
  closed: boolean;
  dishes: DishLine[];
}

export async function computeDayReport(
  db: Db,
  restaurantId: string,
  date: string,
): Promise<DayReport> {
  const [{ data: sales }, { data: batches }, { data: gclose }, { data: dc }] =
    await Promise.all([
      db.from("sales").select("dish_id,dish_name,qty,total")
        .eq("restaurant_id", restaurantId).eq("business_date", date).is("voided_at", null).eq("consumo_interno", false),
      db.from("production_batches").select("total_cost")
        .eq("restaurant_id", restaurantId).eq("business_date", date),
      db.from("granel_close").select("ingredient_id,cost_per_plate,merma_cost")
        .eq("restaurant_id", restaurantId).eq("business_date", date),
      db.from("daily_close").select("status")
        .eq("restaurant_id", restaurantId).eq("business_date", date).maybeSingle(),
    ]);

  const ventas = (sales ?? []).reduce((s, v) => s + Number(v.total), 0);
  const costoDia = (batches ?? []).reduce((s, b) => s + Number(b.total_cost), 0);

  const granelCost = new Map<string, number>();
  let mermaGranel = 0;
  for (const g of gclose ?? []) {
    if (g.cost_per_plate != null) granelCost.set(g.ingredient_id, Number(g.cost_per_plate));
    mermaGranel += Number(g.merma_cost ?? 0);
  }
  const closed = dc?.status === "closed";

  const dishIds = [...new Set((sales ?? []).map((s) => s.dish_id).filter(Boolean))] as string[];
  const compsByDish = new Map<string, { ingredient_id: string; qty: number; kind: string; unitCost: number }[]>();
  if (dishIds.length) {
    const { data: comps } = await db.from("dish_components")
      .select("dish_id, qty, ingredients(id,kind,last_unit_cost)").in("dish_id", dishIds);
    for (const c of comps ?? []) {
      const ing = c.ingredients as unknown as { id: string; kind: string; last_unit_cost: number | null } | null;
      if (!ing) continue;
      const arr = compsByDish.get(c.dish_id) ?? [];
      arr.push({ ingredient_id: ing.id, qty: Number(c.qty), kind: ing.kind, unitCost: Number(ing.last_unit_cost ?? 0) });
      compsByDish.set(c.dish_id, arr);
    }
  }

  const byDish = new Map<string, { name: string; dishId: string | null; qty: number; revenue: number }>();
  for (const s of sales ?? []) {
    const key = s.dish_id ?? s.dish_name ?? "?";
    const e = byDish.get(key) ?? { name: s.dish_name ?? "?", dishId: s.dish_id, qty: 0, revenue: 0 };
    e.qty += Number(s.qty);
    e.revenue += Number(s.total);
    byDish.set(key, e);
  }

  const dishes: DishLine[] = [];
  for (const e of byDish.values()) {
    const comps = e.dishId ? compsByDish.get(e.dishId) : undefined;
    let unitCost = 0;
    let costKnown = !!comps;
    for (const c of comps ?? []) {
      if (c.kind === "contable") unitCost += c.qty * c.unitCost;
      else {
        const cpp = granelCost.get(c.ingredient_id);
        if (cpp == null) costKnown = false;
        else unitCost += cpp;
      }
    }
    const cost = costKnown ? unitCost * e.qty : null;
    dishes.push({
      dishId: e.dishId,
      name: e.name,
      qty: e.qty,
      revenue: e.revenue,
      unitCost: comps ? unitCost : null,
      cost,
      margin: cost != null ? e.revenue - cost : null,
    });
  }
  dishes.sort((a, b) => b.qty - a.qty);

  return { date, ventas, costoDia, margenDia: ventas - costoDia, mermaGranel, closed, dishes };
}

// ===========================================================================
//  RESUMEN FINANCIERO DE UN DÍA (lo que gana ese día, con TODO incluido)
// ===========================================================================
export interface CajaTurno {
  shift: string;
  apertura: number;
  esperada: number;
  contada: number | null;
  descuadre: number | null;
  cerrado: boolean;
}
export interface DaySummary {
  date: string;
  closed: boolean;
  ventas: number;
  insumos: { total: number; items: { name: string; cost: number; granel: boolean }[] };
  productos: { total: number; items: { name: string; cost: number }[] };
  // Compras de inventario del día: entran a stock, NO bajan la utilidad.
  compras: { total: number; items: { name: string; qty: number; unit: string | null; cost: number }[] };
  gastos: { total: number; items: { name: string; cost: number }[] };
  fijos: { operativo: number; administrativo: number; financiero: number; total: number };
  // Consumo interno de empleadas (informativo; su costo ya está dentro de los costos)
  empleadas: { total: number; n: number; items: { name: string; persona: string; cost: number }[] };
  caja: {
    apertura: number;
    ventasEfectivo: number;
    aportes: number;
    egresos: number; // retiros + gastos de caja + compras de caja
    esperada: number;
    contada: number | null; // null si ningún turno cerrado
    descuadre: number | null;
    turnos: CajaTurno[];
  };
  merma: number | null; // null = pendiente de cierre
  utilidad: number;
}

export async function computeDaySummary(
  db: Db,
  restaurantId: string,
  date: string,
): Promise<DaySummary> {
  const [
    { data: sales },
    { data: batches },
    { data: moves },
    { data: gclose },
    { data: dc },
    { data: recurring },
    { data: expenses },
    { data: sessions },
    { data: shifts },
  ] = await Promise.all([
    db.from("sales").select("total,payment_method").eq("restaurant_id", restaurantId).eq("business_date", date).is("voided_at", null).eq("consumo_interno", false),
    db.from("production_batches").select("total_cost, ingredients(name,kind)")
      .eq("restaurant_id", restaurantId).eq("business_date", date),
    db.from("inventory_movements").select("qty,unit_cost,type, ingredients(name,costing_method,consumption_unit)")
      .eq("restaurant_id", restaurantId).eq("business_date", date).is("voided_at", null),
    db.from("granel_close").select("merma_cost").eq("restaurant_id", restaurantId).eq("business_date", date),
    db.from("daily_close").select("status").eq("restaurant_id", restaurantId).eq("business_date", date).maybeSingle(),
    db.from("recurring_costs").select("amount,category,schedule_type,weekdays,active")
      .eq("restaurant_id", restaurantId).eq("active", true),
    db.from("expenses").select("amount,category,note,paid_from_cash")
      .eq("restaurant_id", restaurantId).eq("business_date", date).is("voided_at", null),
    db.from("shift_sessions").select("id,shift_id,status,opening_cash,expected_cash,counted_cash,cash_discrepancy")
      .eq("restaurant_id", restaurantId).eq("business_date", date),
    db.from("shifts").select("id,name,sort_order").eq("restaurant_id", restaurantId).order("sort_order"),
  ]);

  const ventas = (sales ?? []).reduce((s, v) => s + Number(v.total), 0);

  // Insumos cocinados (el "pool del día": granel + tandas contables)
  const insumoMap = new Map<string, { cost: number; granel: boolean }>();
  for (const b of batches ?? []) {
    const ing = b.ingredients as unknown as { name: string; kind: string } | null;
    const name = ing?.name ?? "—";
    const e = insumoMap.get(name) ?? { cost: 0, granel: ing?.kind === "granel" };
    e.cost += Number(b.total_cost);
    insumoMap.set(name, e);
  }
  const insumoItems = [...insumoMap.entries()]
    .map(([name, v]) => ({ name, cost: v.cost, granel: v.granel }))
    .sort((a, b) => b.cost - a.cost);
  const insumosTotal = insumoItems.reduce((s, i) => s + i.cost, 0);

  // Productos vendidos (desechables/reventa: bandejas, colas, verde…). Excluye
  // lo producido en tandas para no duplicar.
  const prodMap = new Map<string, number>();
  // Compras de inventario del día (entran a stock; informativo, no baja la utilidad)
  const compraMap = new Map<string, { qty: number; unit: string | null; cost: number }>();
  let mermaContable = 0;
  for (const m of moves ?? []) {
    const ing = m.ingredients as unknown as
      | { name: string; costing_method: string; consumption_unit: string | null }
      | null;
    const cost = Math.abs(Number(m.qty)) * Number(m.unit_cost);
    if (m.type === "merma") mermaContable += cost;
    if (m.type === "compra") {
      const name = ing?.name ?? "—";
      const e = compraMap.get(name) ?? { qty: 0, unit: ing?.consumption_unit ?? null, cost: 0 };
      e.qty += Math.abs(Number(m.qty));
      e.cost += cost;
      compraMap.set(name, e);
    }
    if (m.type !== "venta") continue;
    if (!ing || ing.costing_method === "tanda") continue; // ya contado en insumos
    prodMap.set(ing.name, (prodMap.get(ing.name) ?? 0) + cost);
  }
  const prodItems = [...prodMap.entries()]
    .map(([name, cost]) => ({ name, cost }))
    .sort((a, b) => b.cost - a.cost);
  const productosTotal = prodItems.reduce((s, i) => s + i.cost, 0);

  const compraItems = [...compraMap.entries()]
    .map(([name, v]) => ({ name, qty: v.qty, unit: v.unit, cost: v.cost }))
    .sort((a, b) => b.cost - a.cost);
  const comprasTotal = compraItems.reduce((s, i) => s + i.cost, 0);

  // Costos fijos prorrateados a ESTE día
  const d = parseLocal(date);
  const wd = d.getDay();
  const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const fijos = { operativo: 0, administrativo: 0, financiero: 0 };
  for (const c of recurring ?? []) {
    const amount = Number(c.amount);
    let monto = 0;
    if (c.schedule_type === "daily") monto = amount;
    else if (c.schedule_type === "weekly") {
      // Semanal: el monto es el total de la semana. Si se eligieron días, se
      // reparte SOLO entre esos días (amount / nº días) y los demás no cargan
      // nada; sin días, se prorratea a la semana entera (amount / 7).
      const wds = (c.weekdays as number[] | null) ?? [];
      monto = wds.length ? (wds.includes(wd) ? amount / wds.length : 0) : amount / 7;
    } else monto = amount / dim;
    if (c.category === "administrativo") fijos.administrativo += monto;
    else if (c.category === "financiero") fijos.financiero += monto;
    else fijos.operativo += monto;
  }
  const fijosTotal = fijos.operativo + fijos.administrativo + fijos.financiero;

  const closed = dc?.status === "closed";
  const mermaGranel = (gclose ?? []).reduce((s, g) => s + Number(g.merma_cost ?? 0), 0);
  const merma = closed ? mermaGranel + mermaContable : null;

  // Gastos del día (consumibles/servicios; ya NO incluye compras de inventario)
  const gastoMap = new Map<string, number>();
  let gastosCajaTotal = 0;
  for (const e of expenses ?? []) {
    const key = e.note?.trim() || e.category || "Gasto";
    gastoMap.set(key, (gastoMap.get(key) ?? 0) + Number(e.amount));
    if (e.paid_from_cash) gastosCajaTotal += Number(e.amount);
  }
  const gastoItems = [...gastoMap.entries()]
    .map(([name, cost]) => ({ name, cost }))
    .sort((a, b) => b.cost - a.cost);
  const gastosTotal = gastoItems.reduce((s, i) => s + i.cost, 0);

  // Caja del día: apertura + ventas efectivo + aportes − egresos (retiros + gastos + compras)
  const sessionIds = (sessions ?? []).map((s) => s.id);
  const [{ data: cashMoves }, { data: cajaLive }] = await Promise.all([
    db.from("cash_movements").select("shift_session_id,type,amount").in("shift_session_id", sessionIds).is("voided_at", null),
    db.from("v_caja_turno").select("shift_session_id,caja_esperada").in("shift_session_id", sessionIds),
  ]);
  const ventasEfectivo = (sales ?? [])
    .filter((s) => s.payment_method === "efectivo")
    .reduce((s, v) => s + Number(v.total), 0);
  const aportes = (cashMoves ?? []).filter((m) => m.type === "ingreso").reduce((s, m) => s + Number(m.amount), 0);
  const egresosCash = (cashMoves ?? []).filter((m) => m.type === "egreso").reduce((s, m) => s + Number(m.amount), 0);
  const egresos = egresosCash + gastosCajaTotal;
  const aperturaTotal = (sessions ?? []).reduce((s, x) => s + Number(x.opening_cash), 0);

  const liveBySession = new Map((cajaLive ?? []).map((c) => [c.shift_session_id, Number(c.caja_esperada)]));
  const shiftNameById = new Map((shifts ?? []).map((s) => [s.id, s.name]));
  const turnos: CajaTurno[] = (sessions ?? []).map((s) => {
    const cerrado = s.status === "closed";
    const esperada = cerrado
      ? Number(s.expected_cash ?? 0)
      : liveBySession.get(s.id) ?? Number(s.opening_cash);
    return {
      shift: shiftNameById.get(s.shift_id) ?? "Turno",
      apertura: Number(s.opening_cash),
      esperada,
      contada: cerrado ? Number(s.counted_cash ?? 0) : null,
      descuadre: cerrado ? Number(s.cash_discrepancy ?? 0) : null,
      cerrado,
    };
  });
  const esperadaTotal = aperturaTotal + ventasEfectivo + aportes - egresos;
  const anyCerrado = turnos.some((t) => t.cerrado);
  const contadaTotal = anyCerrado ? turnos.reduce((s, t) => s + (t.contada ?? 0), 0) : null;
  const descuadreTotal = anyCerrado ? turnos.reduce((s, t) => s + (t.descuadre ?? 0), 0) : null;

  // Consumo de empleadas (interno): informativo — la proteína ya está contada
  // en los costos de arriba; aquí mostramos cuánto comió y quién.
  const { data: internas } = await db
    .from("sales")
    .select("dish_id,dish_name,qty,user_id")
    .eq("restaurant_id", restaurantId)
    .eq("business_date", date)
    .eq("consumo_interno", true)
    .is("voided_at", null);

  const empItems: { name: string; persona: string; cost: number }[] = [];
  let empleadasTotal = 0;
  if (internas && internas.length) {
    const idishIds = [...new Set(internas.map((s) => s.dish_id).filter(Boolean))] as string[];
    const dishCost = new Map<string, number>();
    if (idishIds.length) {
      const { data: ucomps } = await db
        .from("dish_components")
        .select("dish_id, qty, ingredients(kind,last_unit_cost)")
        .in("dish_id", idishIds);
      for (const c of ucomps ?? []) {
        const ing = c.ingredients as unknown as { kind: string; last_unit_cost: number | null } | null;
        if (!ing || ing.kind !== "contable") continue;
        dishCost.set(
          c.dish_id,
          (dishCost.get(c.dish_id) ?? 0) + Number(c.qty) * Number(ing.last_unit_cost ?? 0),
        );
      }
    }
    const { data: us } = await db.from("users").select("id,name").eq("restaurant_id", restaurantId);
    const uname = new Map((us ?? []).map((u) => [u.id, u.name]));
    for (const s of internas) {
      const cost = (s.dish_id ? dishCost.get(s.dish_id) ?? 0 : 0) * Number(s.qty);
      empleadasTotal += cost;
      empItems.push({
        name: s.dish_name ?? "—",
        persona: s.user_id ? uname.get(s.user_id) ?? "—" : "—",
        cost,
      });
    }
  }

  const utilidad = ventas - insumosTotal - productosTotal - gastosTotal - fijosTotal;

  return {
    date,
    closed,
    ventas,
    insumos: { total: insumosTotal, items: insumoItems },
    productos: { total: productosTotal, items: prodItems },
    compras: { total: comprasTotal, items: compraItems },
    gastos: { total: gastosTotal, items: gastoItems },
    fijos: { ...fijos, total: fijosTotal },
    empleadas: { total: empleadasTotal, n: internas?.length ?? 0, items: empItems },
    caja: {
      apertura: aperturaTotal,
      ventasEfectivo,
      aportes,
      egresos,
      esperada: esperadaTotal,
      contada: contadaTotal,
      descuadre: descuadreTotal,
      turnos,
    },
    merma,
    utilidad,
  };
}

// ===========================================================================
//  SALIDAS DE CAJA DE UN DÍA (ledger de desembolsos: gastos + compras + retiros)
//  El total suma TODO lo desembolsado en el día sin importar quién pagó. La
//  fuente (caja / jefa) se muestra por fila como información, no cambia el total.
// ===========================================================================
export interface DaySalida {
  tipo: "gasto" | "compra" | "retiro";
  nombre: string;
  detalle: string | null; // ej. cantidad + unidad para compras
  monto: number;
  fuente: "caja" | "jefa";
  responsable: string | null; // quién lo registró
}
export interface DaySalidas {
  date: string;
  total: number; // lo que salió de caja ese día
  entro: number; // lo que entró ese día (ventas + aportes + ingresos de capital)
  items: DaySalida[];
}

export async function computeDaySalidas(
  db: Db,
  restaurantId: string,
  date: string,
): Promise<DaySalidas> {
  const [{ data: expenses }, { data: moves }, { data: sessions }, { data: sales }, { data: capital }, { data: users }] =
    await Promise.all([
      db.from("expenses").select("amount,category,note,op_id,user_id")
        .eq("restaurant_id", restaurantId).eq("business_date", date).is("voided_at", null),
      db.from("inventory_movements").select("qty,unit_cost,op_id,user_id, ingredients(name,consumption_unit)")
        .eq("restaurant_id", restaurantId).eq("business_date", date).eq("type", "compra").is("voided_at", null),
      db.from("shift_sessions").select("id").eq("restaurant_id", restaurantId).eq("business_date", date),
      // Solo ventas que trajeron dinero (excluye crédito/fiado): el cobro del
      // fiado entra después como ingreso de caja y ya se cuenta en `aportes`.
      db.from("sales").select("total")
        .eq("restaurant_id", restaurantId).eq("business_date", date).is("voided_at", null).eq("consumo_interno", false)
        .neq("payment_method", "credito"),
      db.from("capital_movements").select("type,amount")
        .eq("restaurant_id", restaurantId).eq("business_date", date),
      db.from("users").select("id,name").eq("restaurant_id", restaurantId),
    ]);

  const userName = new Map((users ?? []).map((u) => [u.id, u.name]));
  const who = (id: string | null | undefined) => (id ? userName.get(id) ?? null : null);

  const sessionIds = (sessions ?? []).map((s) => s.id);
  const { data: cash } = sessionIds.length
    ? await db.from("cash_movements").select("type,amount,reason,op_id,user_id")
        .in("shift_session_id", sessionIds).is("voided_at", null)
    : { data: [] as { type: string; amount: number; reason: string | null; op_id: string | null; user_id: string | null }[] };

  // Una operación la "puso la jefa" si tiene un ingreso de caja con el mismo op_id.
  const jefaOps = new Set(
    (cash ?? []).filter((c) => c.type === "ingreso" && c.op_id).map((c) => c.op_id as string),
  );
  // op_ids de las compras: para no duplicarlas al listar los egresos de caja.
  const compraOps = new Set((moves ?? []).map((m) => m.op_id).filter(Boolean) as string[]);

  const items: DaySalida[] = [];

  for (const e of expenses ?? []) {
    items.push({
      tipo: "gasto",
      nombre: e.note?.trim() || e.category || "Gasto",
      detalle: null,
      monto: Number(e.amount),
      fuente: e.op_id && jefaOps.has(e.op_id) ? "jefa" : "caja",
      responsable: who(e.user_id),
    });
  }

  for (const m of moves ?? []) {
    const ing = m.ingredients as unknown as { name: string; consumption_unit: string | null } | null;
    const qty = Math.abs(Number(m.qty));
    items.push({
      tipo: "compra",
      nombre: ing?.name ?? "Compra",
      detalle: `${qty}${ing?.consumption_unit ? ` ${ing.consumption_unit}` : ""}`,
      monto: qty * Number(m.unit_cost),
      fuente: m.op_id && jefaOps.has(m.op_id) ? "jefa" : "caja",
      responsable: who(m.user_id),
    });
  }

  // Otros egresos de caja (retiros) que NO son compras (esas ya están arriba).
  for (const c of cash ?? []) {
    if (c.type !== "egreso") continue;
    if (c.op_id && compraOps.has(c.op_id)) continue;
    items.push({
      tipo: "retiro",
      nombre: c.reason?.trim() || "Retiro de caja",
      detalle: null,
      monto: Number(c.amount),
      fuente: c.op_id && jefaOps.has(c.op_id) ? "jefa" : "caja",
      responsable: who(c.user_id),
    });
  }

  items.sort((a, b) => b.monto - a.monto);
  const total = items.reduce((s, i) => s + i.monto, 0);

  // Entró: ventas del día (todas) + aportes de caja + ingresos de capital del día.
  const ventasDia = (sales ?? []).reduce((s, v) => s + Number(v.total), 0);
  const aportes = (cash ?? []).filter((c) => c.type === "ingreso").reduce((s, c) => s + Number(c.amount), 0);
  const ingresosCapital = (capital ?? []).filter((c) => c.type === "ingreso").reduce((s, c) => s + Number(c.amount), 0);
  const entro = ventasDia + aportes + ingresosCapital;

  return { date, total, entro, items };
}

// ===========================================================================
//  FLUJO DE CAJA DEL NEGOCIO (capital acumulado — todo el histórico)
//  "El dinero que queda" = lo que entró − lo que salió ± cuadres. Es el capital
//  con el que trabaja el negocio y que se le entrega a la dueña.
// ===========================================================================
export interface FlujoCaja {
  ventas: number; // ventas cobradas (efectivo + transferencia + otro), sin crédito ni consumo interno
  aportes: number; // ingresos de caja del turno (la jefa puso plata en una operación)
  ingresosCapital: number; // ingresos de capital registrados (la jefa manda plata)
  compras: number; // compras de inventario
  gastos: number; // gastos del día
  retirosCaja: number; // egresos de caja que no son compras (retiros varios)
  retirosCapital: number; // entregas a la dueña registradas
  ajusteCuadres: number; // Σ descuadre de cierres (excedente + / faltante −)
  capital: number; // = entradas − salidas + ajusteCuadres
}

export async function computeFlujoCaja(db: Db, restaurantId: string): Promise<FlujoCaja> {
  const [
    { data: sales },
    { data: moves },
    { data: expenses },
    { data: cash },
    { data: capital },
    { data: sessions },
  ] = await Promise.all([
    // Ventas que SÍ trajeron dinero: excluye crédito (fiado). El fiado no entra
    // como plata; cuando se cobra llega como ingreso de caja ('cobro_credito')
    // y se cuenta en `aportes`. Sumarlo aquí lo contaría doble / antes de tiempo.
    db.from("sales").select("total")
      .eq("restaurant_id", restaurantId).is("voided_at", null).eq("consumo_interno", false)
      .neq("payment_method", "credito"),
    db.from("inventory_movements").select("qty,unit_cost,op_id")
      .eq("restaurant_id", restaurantId).eq("type", "compra").is("voided_at", null),
    db.from("expenses").select("amount")
      .eq("restaurant_id", restaurantId).is("voided_at", null),
    db.from("cash_movements").select("type,amount,op_id")
      .eq("restaurant_id", restaurantId).is("voided_at", null),
    db.from("capital_movements").select("type,amount").eq("restaurant_id", restaurantId),
    db.from("shift_sessions").select("cash_discrepancy,status").eq("restaurant_id", restaurantId).eq("status", "closed"),
  ]);

  const ventas = (sales ?? []).reduce((s, v) => s + Number(v.total), 0);
  const compras = (moves ?? []).reduce((s, m) => s + Math.abs(Number(m.qty)) * Number(m.unit_cost), 0);
  const gastos = (expenses ?? []).reduce((s, e) => s + Number(e.amount), 0);

  // op_ids de compras: los egresos de caja con ese op_id ya están en `compras`.
  const compraOps = new Set((moves ?? []).map((m) => m.op_id).filter(Boolean) as string[]);
  const aportes = (cash ?? []).filter((c) => c.type === "ingreso").reduce((s, c) => s + Number(c.amount), 0);
  const retirosCaja = (cash ?? [])
    .filter((c) => c.type === "egreso" && !(c.op_id && compraOps.has(c.op_id)))
    .reduce((s, c) => s + Number(c.amount), 0);

  const ingresosCapital = (capital ?? []).filter((c) => c.type === "ingreso").reduce((s, c) => s + Number(c.amount), 0);
  const retirosCapital = (capital ?? []).filter((c) => c.type === "retiro").reduce((s, c) => s + Number(c.amount), 0);

  const ajusteCuadres = (sessions ?? []).reduce((s, x) => s + Number(x.cash_discrepancy ?? 0), 0);

  const capitalTotal =
    ventas + aportes + ingresosCapital - compras - gastos - retirosCaja - retirosCapital + ajusteCuadres;

  return {
    ventas,
    aportes,
    ingresosCapital,
    compras,
    gastos,
    retirosCaja,
    retirosCapital,
    ajusteCuadres,
    capital: capitalTotal,
  };
}

// ===========================================================================
//  ANALÍTICA (rango from..to) — anti-robo + rankings
// ===========================================================================
export interface Analytics {
  // salud financiera
  ventas: number;
  costoDirecto: number;
  margenContribucion: number;
  fijos: number;
  gastos: number; // gastos operativos no-inventario (servilletas, escoba, propinas…)
  gastosItems: { name: string; cost: number }[];
  gastosPorResponsable: { responsable: string; total: number; n: number }[];
  utilidadNeta: number;
  margenPct: number;
  mermaTotal: number;
  desfaseTotal: number; // neto (negativo = perdido)
  perdidaTotal: number; // mermas + pérdidas por desfase
  indiceContraccion: number; // % merma / pool
  // mapa de calor día x turno
  shiftCols: { id: string; name: string }[];
  heatmap: {
    weekday: number;
    label: string;
    cells: { shiftId: string; ventas: number; costo: number; efic: number | null }[];
  }[];
  // tendencia diaria: ventas vs costos totales (gap = utilidad del día)
  serieDiaria: { date: string; ventas: number; costos: number; utilidad: number }[];
  ventasPrev: number; // ventas del periodo inmediatamente anterior (igual longitud)
  ventasDeltaPct: number | null;
  // ingeniería de menú (normalizada por día servido)
  platos: { name: string; ventas: number; costo: number; dias: number; gananciaPorDia: number; margenPct: number }[];
  // merma histórica
  mermaPorDia: { date: string; merma: number }[];
  mermaInsight: string | null;
  // desfases (anti-robo)
  desfasePorDia: { date: string; cash: number; inventario: number; total: number }[];
  desfasePorResponsable: { responsable: string; total: number; n: number }[];
}

function fdate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shiftYmd(s: string, delta: number): string {
  const d = parseLocal(s);
  d.setDate(d.getDate() + delta);
  return fdate(d);
}

export async function computeAnalytics(
  db: Db,
  restaurantId: string,
  from: string,
  to: string,
): Promise<Analytics> {
  const len = eachDate(from, to).length || 1;
  const prevTo = shiftYmd(from, -1);
  const prevFrom = shiftYmd(from, -len);

  const [
    { data: sales },
    { data: sessions },
    { data: shifts },
    { data: users },
    { data: ddc },
    { data: dishes },
    { data: recurring },
    { data: batches },
    { data: moves },
    { data: gclose },
    { data: expensesRows },
    { data: prevSales },
  ] = await Promise.all([
    db.from("sales").select("total,business_date,shift_session_id")
      .eq("restaurant_id", restaurantId).gte("business_date", from).lte("business_date", to).is("voided_at", null).eq("consumo_interno", false),
    db.from("shift_sessions").select("id,business_date,shift_id,responsible_user_id,status,cash_discrepancy")
      .eq("restaurant_id", restaurantId).gte("business_date", from).lte("business_date", to),
    db.from("shifts").select("id,name,sort_order").eq("restaurant_id", restaurantId).eq("active", true).order("sort_order"),
    db.from("users").select("id,name").eq("restaurant_id", restaurantId),
    db.from("dish_daily_cost").select("dish_id,business_date,unit_cost,price,qty")
      .eq("restaurant_id", restaurantId).gte("business_date", from).lte("business_date", to),
    db.from("dishes").select("id,name").eq("restaurant_id", restaurantId),
    db.from("recurring_costs").select("amount,category,schedule_type,weekdays,shift_id,active")
      .eq("restaurant_id", restaurantId).eq("active", true),
    db.from("production_batches").select("total_cost,business_date")
      .eq("restaurant_id", restaurantId).gte("business_date", from).lte("business_date", to),
    db.from("inventory_movements").select("type,qty,unit_cost,total_cost,business_date,user_id, ingredients(costing_method)")
      .eq("restaurant_id", restaurantId).gte("business_date", from).lte("business_date", to).is("voided_at", null),
    db.from("granel_close").select("business_date,merma_cost,pool_cost")
      .eq("restaurant_id", restaurantId).gte("business_date", from).lte("business_date", to),
    db.from("expenses").select("amount,category,note,user_id,business_date")
      .eq("restaurant_id", restaurantId).gte("business_date", from).lte("business_date", to).is("voided_at", null),
    db.from("sales").select("total")
      .eq("restaurant_id", restaurantId).gte("business_date", prevFrom).lte("business_date", prevTo).is("voided_at", null).eq("consumo_interno", false),
  ]);

  const dates = eachDate(from, to);
  const occByWd = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dates) occByWd[d.getDay()]++;

  const userName = new Map((users ?? []).map((u) => [u.id, u.name]));
  const dishName = new Map((dishes ?? []).map((d) => [d.id, d.name]));
  const sessionShift = new Map((sessions ?? []).map((s) => [s.id, s.shift_id]));

  const ventas = (sales ?? []).reduce((s, v) => s + Number(v.total), 0);

  // costo directo = producción + productos vendidos (no-tanda)
  let costoDirecto = (batches ?? []).reduce((s, b) => s + Number(b.total_cost), 0);
  let mermaInv = 0;
  for (const m of moves ?? []) {
    const ing = m.ingredients as unknown as { costing_method: string } | null;
    const cost = Math.abs(Number(m.qty)) * Number(m.unit_cost);
    if (m.type === "merma") mermaInv += cost;
    if (m.type === "venta" && ing && ing.costing_method !== "tanda") costoDirecto += cost;
  }
  const margenContribucion = ventas - costoDirecto;

  // fijos prorrateados al rango
  let fijos = 0;
  for (const c of recurring ?? []) {
    const amount = Number(c.amount);
    if (c.schedule_type === "daily") fijos += amount * dates.length;
    else if (c.schedule_type === "weekly") {
      const wd = (c.weekdays as number[] | null) ?? [];
      fijos += wd.length
        ? (amount / wd.length) * dates.filter((d) => wd.includes(d.getDay())).length
        : amount * (dates.length / 7);
    } else fijos += amount * (dates.length / 30);
  }
  // gastos operativos no-inventario (servilletas, escoba, propinas, desinfectante…)
  const gastoConcepto = new Map<string, number>();
  const gastoResp = new Map<string, { total: number; n: number }>();
  for (const e of expensesRows ?? []) {
    const concept = e.note?.trim() || e.category || "Gasto";
    gastoConcepto.set(concept, (gastoConcepto.get(concept) ?? 0) + Number(e.amount));
    const name = e.user_id ? userName.get(e.user_id) ?? "—" : "—";
    const r = gastoResp.get(name) ?? { total: 0, n: 0 };
    r.total += Number(e.amount);
    r.n += 1;
    gastoResp.set(name, r);
  }
  const gastosItems = [...gastoConcepto.entries()]
    .map(([name, cost]) => ({ name, cost }))
    .sort((a, b) => b.cost - a.cost);
  const gastos = gastosItems.reduce((s, i) => s + i.cost, 0);
  const gastosPorResponsable = [...gastoResp.entries()]
    .map(([responsable, v]) => ({ responsable, ...v }))
    .sort((a, b) => b.total - a.total);

  const utilidadNeta = margenContribucion - fijos - gastos;
  const margenPct = ventas > 0 ? (margenContribucion / ventas) * 100 : 0;

  // merma (granel + inventario)
  const mermaByDate = new Map<string, number>();
  let poolTotal = 0;
  for (const g of gclose ?? []) {
    mermaByDate.set(g.business_date, (mermaByDate.get(g.business_date) ?? 0) + Number(g.merma_cost ?? 0));
    poolTotal += Number(g.pool_cost ?? 0);
  }
  for (const m of moves ?? []) {
    if (m.type !== "merma") continue;
    const v = Math.abs(Number(m.qty)) * Number(m.unit_cost);
    mermaByDate.set(m.business_date, (mermaByDate.get(m.business_date) ?? 0) + v);
  }
  const mermaPorDia = dates.map((d) => ({ date: fdate(d), merma: mermaByDate.get(fdate(d)) ?? 0 }));
  const mermaTotal = mermaPorDia.reduce((s, m) => s + m.merma, 0);
  const indiceContraccion = poolTotal > 0 ? (mermaTotal / poolTotal) * 100 : 0;

  // insight de merma: día de la semana con más desperdicio promedio
  const mermaWd = [0, 0, 0, 0, 0, 0, 0];
  for (const m of mermaPorDia) mermaWd[parseLocal(m.date).getDay()] += m.merma;
  let mermaInsight: string | null = null;
  if (mermaTotal > 0) {
    let best = 0;
    for (let i = 1; i < 7; i++) {
      if ((mermaWd[i] / (occByWd[i] || 1)) > (mermaWd[best] / (occByWd[best] || 1))) best = i;
    }
    if (mermaWd[best] > 0) mermaInsight = `Los ${WEEKDAYS[best]} es cuando más se desperdicia. Reduce el pool inicial ese día.`;
  }

  // desfases: caja (cierre) + inventario (ajuste)
  const cashByDate = new Map<string, number>();
  const invByDate = new Map<string, number>();
  const respMap = new Map<string, { total: number; n: number }>();
  for (const s of sessions ?? []) {
    if (s.status !== "closed" || s.cash_discrepancy == null) continue;
    const v = Number(s.cash_discrepancy);
    if (v === 0) continue;
    cashByDate.set(s.business_date, (cashByDate.get(s.business_date) ?? 0) + v);
    const name = s.responsible_user_id ? (userName.get(s.responsible_user_id) ?? "—") : "—";
    const e = respMap.get(name) ?? { total: 0, n: 0 };
    e.total += v;
    e.n += 1;
    respMap.set(name, e);
  }
  for (const m of moves ?? []) {
    if (m.type !== "ajuste") continue;
    const v = Number(m.total_cost ?? 0);
    if (v === 0) continue;
    invByDate.set(m.business_date, (invByDate.get(m.business_date) ?? 0) + v);
    const name = m.user_id ? (userName.get(m.user_id) ?? "—") : "—";
    const e = respMap.get(name) ?? { total: 0, n: 0 };
    e.total += v;
    e.n += 1;
    respMap.set(name, e);
  }
  const desfasePorDia = dates.map((d) => {
    const k = fdate(d);
    const cash = cashByDate.get(k) ?? 0;
    const inventario = invByDate.get(k) ?? 0;
    return { date: k, cash, inventario, total: cash + inventario };
  });
  const desfaseTotal = desfasePorDia.reduce((s, x) => s + x.total, 0);
  const desfasePorResponsable = [...respMap.entries()]
    .map(([responsable, v]) => ({ responsable, ...v }))
    .sort((a, b) => a.total - b.total);
  const perdidaTotal = mermaTotal + (desfaseTotal < 0 ? -desfaseTotal : 0);

  // mapa de calor día x turno (eficiencia = ventas / costo personal)
  const ventasGrid = new Map<string, number>();
  for (const s of sales ?? []) {
    const shiftId = sessionShift.get(s.shift_session_id);
    if (!shiftId) continue;
    const w = parseLocal(s.business_date).getDay();
    const k = `${w}|${shiftId}`;
    ventasGrid.set(k, (ventasGrid.get(k) ?? 0) + Number(s.total));
  }
  // sueldo por día para cada (turno, día de semana)
  const sueldoDia = new Map<string, number>(); // `${shift}|${w}`
  for (const c of recurring ?? []) {
    if (c.category !== "operativo" || !c.shift_id) continue;
    const amount = Number(c.amount);
    const wds = (c.weekdays as number[] | null) ?? [];
    for (let w = 0; w < 7; w++) {
      let perDay = 0;
      if (c.schedule_type === "daily") perDay = amount;
      else if (c.schedule_type === "weekly") perDay = wds.length ? (wds.includes(w) ? amount / wds.length : 0) : amount / 7;
      else perDay = amount / 30;
      if (perDay > 0) sueldoDia.set(`${c.shift_id}|${w}`, (sueldoDia.get(`${c.shift_id}|${w}`) ?? 0) + perDay);
    }
  }
  // costo de personal SOLO de los días realmente operados (con turno abierto)
  const laborGrid = new Map<string, number>();
  const opSeen = new Set<string>();
  for (const s of sessions ?? []) {
    const dayKey = `${s.business_date}|${s.shift_id}`;
    if (opSeen.has(dayKey)) continue;
    opSeen.add(dayKey);
    const w = parseLocal(s.business_date).getDay();
    const sd = sueldoDia.get(`${s.shift_id}|${w}`) ?? 0;
    const k = `${w}|${s.shift_id}`;
    laborGrid.set(k, (laborGrid.get(k) ?? 0) + sd);
  }
  const shiftCols = (shifts ?? []).map((s) => ({ id: s.id, name: s.name }));
  const order = [1, 2, 3, 4, 5, 6, 0];
  const heatmap = order.map((w) => ({
    weekday: w,
    label: WEEKDAYS[w],
    cells: shiftCols.map((sh) => {
      const v = ventasGrid.get(`${w}|${sh.id}`) ?? 0;
      const c = laborGrid.get(`${w}|${sh.id}`) ?? 0;
      return { shiftId: sh.id, ventas: v, costo: c, efic: c > 0 ? v / c : null };
    }),
  }));

  // ingeniería de menú normalizada por día servido
  const platoMap = new Map<string, { ventas: number; costo: number; dias: Set<string> }>();
  for (const r of ddc ?? []) {
    const e = platoMap.get(r.dish_id) ?? { ventas: 0, costo: 0, dias: new Set<string>() };
    e.ventas += Number(r.price) * Number(r.qty);
    e.costo += Number(r.unit_cost) * Number(r.qty);
    if (Number(r.qty) > 0) e.dias.add(r.business_date);
    platoMap.set(r.dish_id, e);
  }
  const platos = [...platoMap.entries()]
    .map(([id, v]) => {
      const utilidad = v.ventas - v.costo;
      const dias = v.dias.size || 1;
      return {
        name: dishName.get(id) ?? "—",
        ventas: v.ventas,
        costo: v.costo,
        dias: v.dias.size,
        gananciaPorDia: utilidad / dias,
        margenPct: v.ventas > 0 ? (utilidad / v.ventas) * 100 : 0,
      };
    })
    .sort((a, b) => b.gananciaPorDia - a.gananciaPorDia);

  // tendencia diaria: ventas vs costos totales del día (directo + gastos + fijos)
  const ventasByDate = new Map<string, number>();
  for (const s of sales ?? [])
    ventasByDate.set(s.business_date, (ventasByDate.get(s.business_date) ?? 0) + Number(s.total));
  const costoDirByDate = new Map<string, number>();
  for (const b of batches ?? [])
    costoDirByDate.set(b.business_date, (costoDirByDate.get(b.business_date) ?? 0) + Number(b.total_cost));
  for (const m of moves ?? []) {
    const ing = m.ingredients as unknown as { costing_method: string } | null;
    if (m.type === "venta" && ing && ing.costing_method !== "tanda") {
      const v = Math.abs(Number(m.qty)) * Number(m.unit_cost);
      costoDirByDate.set(m.business_date, (costoDirByDate.get(m.business_date) ?? 0) + v);
    }
  }
  const gastosByDate = new Map<string, number>();
  for (const e of expensesRows ?? [])
    gastosByDate.set(e.business_date, (gastosByDate.get(e.business_date) ?? 0) + Number(e.amount));

  const serieDiaria = dates.map((d) => {
    const k = fdate(d);
    const wd = d.getDay();
    let fijoDia = 0;
    for (const c of recurring ?? []) {
      const amount = Number(c.amount);
      if (c.schedule_type === "daily") fijoDia += amount;
      else if (c.schedule_type === "weekly") {
        const wds = (c.weekdays as number[] | null) ?? [];
        fijoDia += wds.length ? (wds.includes(wd) ? amount / wds.length : 0) : amount / 7;
      } else fijoDia += amount / 30;
    }
    const ventasD = ventasByDate.get(k) ?? 0;
    const costos = (costoDirByDate.get(k) ?? 0) + (gastosByDate.get(k) ?? 0) + fijoDia;
    return { date: k, ventas: ventasD, costos, utilidad: ventasD - costos };
  });

  const ventasPrev = (prevSales ?? []).reduce((s, v) => s + Number(v.total), 0);
  const ventasDeltaPct = ventasPrev > 0 ? ((ventas - ventasPrev) / ventasPrev) * 100 : null;

  return {
    ventas,
    costoDirecto,
    margenContribucion,
    fijos,
    gastos,
    gastosItems,
    gastosPorResponsable,
    utilidadNeta,
    margenPct,
    mermaTotal,
    desfaseTotal,
    perdidaTotal,
    indiceContraccion,
    shiftCols,
    heatmap,
    serieDiaria,
    ventasPrev,
    ventasDeltaPct,
    platos,
    mermaPorDia,
    mermaInsight,
    desfasePorDia,
    desfasePorResponsable,
  };
}

// ===========================================================================
//  HISTORIAL DE COSTO DE UN PLATO
// ===========================================================================
export async function listDishCatalog(db: Db, restaurantId: string) {
  const { data } = await db.from("dishes").select("id,name,price,active")
    .eq("restaurant_id", restaurantId).order("name");
  return data ?? [];
}

export async function computeDishHistory(
  db: Db,
  restaurantId: string,
  dishId: string,
  from: string,
  to: string,
) {
  const { data } = await db.from("dish_daily_cost")
    .select("business_date,unit_cost,price")
    .eq("restaurant_id", restaurantId).eq("dish_id", dishId)
    .gte("business_date", from).lte("business_date", to)
    .order("business_date");
  return (data ?? []).map((r) => ({
    date: r.business_date,
    costo: Number(r.unit_cost),
    precio: Number(r.price),
  }));
}

// ===========================================================================
//  ESTADO DE RESULTADOS MENSUAL (por mes) + proyección de punto de equilibrio
// ===========================================================================
export interface MonthlyPnL {
  year: number;
  month: number; // 1-12
  daysInMonth: number;
  daysElapsed: number; // mes en curso = hoy; meses pasados = completo
  enCurso: boolean;
  ventas: number;
  costoDirecto: number;
  margenContribucion: number;
  fijoOperativo: number;
  fijoAdministrativo: number;
  fijoFinanciero: number;
  fijoTotal: number;
  utilidadOperativa: number;
  utilidadNeta: number;
  margenRatio: number;
  ventaDiariaProm: number;
  puntoEquilibrioDiario: number | null; // venta/día para cubrir los fijos
  diasParaEquilibrio: number | null; // a la venta diaria actual
  proyeccion: { dia: number; acumulado: number }[];
}

export async function computeMonthlyPnL(
  db: Db,
  restaurantId: string,
  year: number,
  month: number,
): Promise<MonthlyPnL> {
  const mm = String(month).padStart(2, "0");
  const daysInMonth = new Date(year, month, 0).getDate();
  const from = `${year}-${mm}-01`;
  const to = `${year}-${mm}-${String(daysInMonth).padStart(2, "0")}`;

  const [{ data: sales }, { data: batches }, { data: moves }, { data: recurring }] =
    await Promise.all([
      db.from("sales").select("total")
        .eq("restaurant_id", restaurantId).gte("business_date", from).lte("business_date", to)
        .is("voided_at", null).eq("consumo_interno", false),
      db.from("production_batches").select("total_cost")
        .eq("restaurant_id", restaurantId).gte("business_date", from).lte("business_date", to),
      db.from("inventory_movements").select("type,qty,unit_cost, ingredients(costing_method)")
        .eq("restaurant_id", restaurantId).gte("business_date", from).lte("business_date", to).is("voided_at", null),
      db.from("recurring_costs").select("amount,category,schedule_type,weekdays,active,created_at")
        .eq("restaurant_id", restaurantId).eq("active", true),
    ]);

  const ventas = (sales ?? []).reduce((s, v) => s + Number(v.total), 0);
  let costoDirecto = (batches ?? []).reduce((s, b) => s + Number(b.total_cost), 0);
  for (const m of moves ?? []) {
    const ing = m.ingredients as unknown as { costing_method: string } | null;
    if (m.type === "venta" && ing && ing.costing_method !== "tanda") {
      costoDirecto += Math.abs(Number(m.qty)) * Number(m.unit_cost);
    }
  }
  const margenContribucion = ventas - costoDirecto;

  // Ocurrencias de cada día de semana en el mes (para costos semanales).
  const wdCount = [0, 0, 0, 0, 0, 0, 0];
  for (let d = 1; d <= daysInMonth; d++) wdCount[new Date(year, month - 1, d).getDay()]++;

  // Un costo fijo solo aplica desde el mes en que se registró: no se proyecta
  // hacia atrás a meses en los que aún no existía (evita utilidades negativas
  // retroactivas en meses sin actividad).
  const monthKey = `${year}-${mm}`;
  const fijos = { operativo: 0, administrativo: 0, financiero: 0 };
  for (const c of recurring ?? []) {
    if (String(c.created_at).slice(0, 7) > monthKey) continue;
    const amount = Number(c.amount);
    let monto = 0;
    if (c.schedule_type === "monthly") monto = amount; // el mes completo = el monto, una vez
    else if (c.schedule_type === "weekly") {
      const wds = (c.weekdays as number[] | null) ?? [];
      monto = wds.length
        ? (amount / wds.length) * wds.reduce((s, w) => s + (wdCount[w] ?? 0), 0)
        : amount * (daysInMonth / 7);
    } else monto = amount * daysInMonth; // daily
    if (c.category === "administrativo") fijos.administrativo += monto;
    else if (c.category === "financiero") fijos.financiero += monto;
    else fijos.operativo += monto;
  }
  const fijoTotal = fijos.operativo + fijos.administrativo + fijos.financiero;
  const utilidadOperativa = margenContribucion - fijos.operativo - fijos.administrativo;
  const utilidadNeta = utilidadOperativa - fijos.financiero;

  // Proyección de punto de equilibrio a la venta diaria actual.
  const hoy = parseLocal(businessDate());
  const enCurso = hoy.getFullYear() === year && hoy.getMonth() + 1 === month;
  const daysElapsed = enCurso ? hoy.getDate() : daysInMonth;
  const margenRatio = ventas > 0 ? margenContribucion / ventas : 0;
  const ventaDiariaProm = daysElapsed > 0 ? ventas / daysElapsed : 0;
  const contribDiaria = ventaDiariaProm * margenRatio;
  const puntoEquilibrioDiario = margenRatio > 0 ? fijoTotal / daysInMonth / margenRatio : null;
  const diasParaEquilibrio = contribDiaria > 0 ? Math.ceil(fijoTotal / contribDiaria) : null;
  const proyeccion = Array.from({ length: daysInMonth }, (_, i) => ({
    dia: i + 1,
    acumulado: Math.round(((i + 1) * contribDiaria - fijoTotal) * 100) / 100,
  }));

  return {
    year,
    month,
    daysInMonth,
    daysElapsed,
    enCurso,
    ventas,
    costoDirecto,
    margenContribucion,
    fijoOperativo: fijos.operativo,
    fijoAdministrativo: fijos.administrativo,
    fijoFinanciero: fijos.financiero,
    fijoTotal,
    utilidadOperativa,
    utilidadNeta,
    margenRatio,
    ventaDiariaProm,
    puntoEquilibrioDiario,
    diasParaEquilibrio,
    proyeccion,
  };
}

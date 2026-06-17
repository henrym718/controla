"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Plus, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PageTitle } from "@/components/ui";
import { parseLocal, eachDate } from "@/lib/range";
import {
  agregarAlMenu,
  agregarVariosAlMenu,
  crearComboEnMenu,
  reordenarMenu,
  quitarDelMenu,
  toggleAgotado,
  copiarMenu,
} from "../actions";

interface DishRow {
  id: string;
  name: string;
  catalogPrice: number;
  inMenu: boolean;
  price: number;
  available: boolean;
  sortOrder: number;
  kind: "plato" | "combo";
}

interface ComboItem {
  id: string;
  name: string;
  price: number;
  isExtra: boolean;
  category: "sopa" | "principal";
}

const KIND_TAG: Record<DishRow["kind"], { label: string; cls: string } | null> = {
  plato: null,
  combo: { label: "combo", cls: "bg-mint" },
};

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const WD = ["D", "L", "M", "M", "J", "V", "S"];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dateLabel(date: string, today: string): string {
  if (date === today) return "Hoy";
  const d = parseLocal(date);
  return `${d.getDate()} de ${MESES[d.getMonth()]}`;
}

const inputCls =
  "rounded-xl border border-ink/15 px-2 py-1.5 text-sm outline-none focus:border-ink/40";
const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export default function MenuClient({
  isAdmin,
  today,
  date,
  dishes,
  comboItems,
}: {
  isAdmin: boolean;
  today: string;
  date: string;
  dishes: DishRow[];
  comboItems: ComboItem[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const boardPath = pathname.replace(/\/editar$/, ""); // .../menu
  const [showCopy, setShowCopy] = useState(false);
  const [bulkPending, startBulk] = useTransition();
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<DishRow["kind"], boolean>>({
    plato: false,
    combo: false,
  });
  const [showComboForm, setShowComboForm] = useState(false);

  const addAll = (items: DishRow[]) => {
    const payload = items.map((d) => ({ dishId: d.id, price: d.catalogPrice }));
    if (payload.length === 0) return;
    startBulk(async () => {
      await agregarVariosAlMenu({ items: payload, date });
      router.refresh();
    });
  };

  const go = (d: string) => router.push(`${pathname}?date=${d}`);
  const stepDay = (delta: number) => {
    const d = parseLocal(date);
    d.setDate(d.getDate() + delta);
    go(ymd(d));
  };

  const enMenu = dishes
    .filter((d) => d.inMenu)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const fuera = dishes.filter((d) => !d.inMenu);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <PageTitle title="Editar menú" />
        <Link
          href={`${boardPath}?date=${date}`}
          className="shrink-0 rounded-full border border-ink/15 px-4 py-1.5 text-sm font-semibold"
        >
          Ver menú
        </Link>
      </div>

      {isAdmin && (
        <DateStepper date={date} today={today} onStep={stepDay} />
      )}

      {isAdmin && enMenu.length > 0 && (
        <button
          onClick={() => setShowCopy((v) => !v)}
          className="self-start rounded-full border border-ink/15 px-4 py-1.5 text-sm font-semibold"
        >
          {showCopy ? "Cerrar" : "Programar: copiar este menú a otros días"}
        </button>
      )}
      {showCopy && (
        <CopyPanel
          date={date}
          onDone={() => {
            setShowCopy(false);
            router.refresh();
          }}
        />
      )}

      {enMenu.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide opacity-50">En el menú</p>
            {enMenu.length > 1 && (
              <p className="text-xs opacity-40">Mantén pulsado ⋮⋮ y arrastra para ordenar</p>
            )}
          </div>
          <SortableMenu items={enMenu} date={date} />
        </div>
      )}

      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide opacity-50">
          Opciones de menú
        </p>

        {fuera.length === 0 ? (
          <p className="text-sm opacity-50">Todo el catálogo ya está en el menú.</p>
        ) : (
          <>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 opacity-40">
                🔍
              </span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar plato o combo disponible…"
                className="w-full rounded-2xl border border-ink/15 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-ink/40"
              />
            </div>

            {(
              [
                { kind: "plato", label: "Agregar platos" },
                { kind: "combo", label: "Agregar combos" },
              ] as const
            ).map((g) => {
              const isCombo = g.kind === "combo";
              const groupItems = fuera.filter((d) => d.kind === g.kind);
              // El grupo de combos se muestra siempre (aunque esté vacío) para
              // poder crear el primer combo con el botón “+”.
              if (groupItems.length === 0 && !isCombo) return null;
              const q = norm(query.trim());
              const items =
                q === "" ? groupItems : groupItems.filter((d) => norm(d.name).includes(q));
              const expanded = q !== "" || openGroups[g.kind];

              return (
                <div key={g.kind} className="overflow-hidden rounded-2xl border border-ink/10">
                  <div className="flex items-center bg-ink/[0.03]">
                    <button
                      onClick={() =>
                        setOpenGroups((p) => ({ ...p, [g.kind]: !p[g.kind] }))
                      }
                      className="flex flex-1 items-center justify-between gap-2 px-4 py-3 text-left"
                    >
                      <span className="text-sm font-semibold">
                        {g.label}
                        <span className="ml-2 text-xs font-normal opacity-50">
                          {q !== ""
                            ? `${items.length} resultado${items.length === 1 ? "" : "s"}`
                            : `${groupItems.length} disponible${groupItems.length === 1 ? "" : "s"}`}
                        </span>
                      </span>
                      <span
                        className={`text-base transition-transform ${expanded ? "rotate-180" : ""}`}
                      >
                        ⌄
                      </span>
                    </button>
                    {isCombo && isAdmin && (
                      <button
                        onClick={() => {
                          setOpenGroups((p) => ({ ...p, combo: true }));
                          setShowComboForm((v) => !v);
                        }}
                        title="Crear combo"
                        aria-label="Crear combo"
                        className="mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-white"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {expanded && (
                    <div className="flex flex-col gap-2 border-t border-ink/10 p-3">
                      {isCombo && showComboForm && (
                        <ComboForm
                          items={comboItems}
                          date={date}
                          onDone={() => {
                            setShowComboForm(false);
                            router.refresh();
                          }}
                        />
                      )}
                      {items.length > 1 && (
                        <button
                          onClick={() => addAll(items)}
                          disabled={bulkPending}
                          className="self-end rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {bulkPending ? "Agregando…" : `Agregar todos (${items.length})`}
                        </button>
                      )}
                      {items.length === 0 ? (
                        <p className="px-1 py-2 text-sm opacity-50">
                          {isCombo ? "No hay combos disponibles. Crea uno con “+”." : "Sin resultados."}
                        </p>
                      ) : (
                        <div className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
                          {items.map((d) => (
                            <Row key={d.id} dish={d} date={date} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function DateStepper({
  date,
  today,
  onStep,
}: {
  date: string;
  today: string;
  onStep: (delta: number) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-2">
      <button
        onClick={() => onStep(-1)}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-ink/5 text-xl font-bold"
      >
        ‹
      </button>
      <div className="min-w-32 text-center">
        <p className="text-base font-bold leading-tight">{dateLabel(date, today)}</p>
        {date !== today && <p className="text-xs opacity-50">{date}</p>}
      </div>
      <button
        onClick={() => onStep(1)}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-ink/5 text-xl font-bold"
      >
        ›
      </button>
    </div>
  );
}

// Lista del menú del día arrastrable (drag & drop) para fijar el orden. El orden
// se guarda en daily_menu.sort_order; el board "/menu" y "Registrar venta" leen
// ese mismo orden, así es estándar para todos. Se arrastra desde el asa ⋮⋮ para
// no chocar con el scroll del teléfono.
function SortableMenu({ items, date }: { items: DishRow[]; date: string }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [order, setOrder] = useState(() => items.map((d) => d.id));
  const idsKey = items.map((d) => d.id).join(",");

  // Tras refrescar (reordenar, agregar o quitar), sincroniza con el servidor.
  useEffect(() => {
    setOrder(items.map((d) => d.id));
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const byId = new Map(items.map((d) => [d.id, d]));
  const ordered = order.map((id) => byId.get(id)).filter((d): d is DishRow => !!d);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(String(active.id));
    const newIndex = order.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next);
    start(async () => {
      await reordenarMenu({ dishIds: next, date });
      router.refresh();
    });
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2">
          {ordered.map((d) => (
            <SortableRow key={d.id} dish={d} date={date} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ dish, date }: { dish: DishRow; date: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: dish.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
    zIndex: isDragging ? 20 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className="flex items-stretch gap-1">
      <button
        {...attributes}
        {...listeners}
        aria-label="Arrastrar para reordenar"
        className="flex w-9 shrink-0 touch-none cursor-grab items-center justify-center rounded-xl text-ink/30 active:cursor-grabbing"
      >
        <GripVertical className="h-5 w-5" />
      </button>
      <div className="flex-1">
        <Row dish={dish} date={date} />
      </div>
    </div>
  );
}

function Row({ dish, date }: { dish: DishRow; date: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      router.refresh();
    });

  return (
    <div
      className={`flex items-center gap-2 rounded-2xl border px-3 py-2.5 ${
        dish.inMenu && !dish.available
          ? "border-ink/10 bg-ink/[0.03] opacity-60"
          : "border-ink/10"
      }`}
    >
      <span className="flex flex-1 items-center gap-1.5 text-sm font-medium">
        {dish.name}
        {KIND_TAG[dish.kind] && (
          <span
            className={`rounded-full ${KIND_TAG[dish.kind]!.cls} px-2 py-0.5 text-[10px] font-semibold`}
          >
            {KIND_TAG[dish.kind]!.label}
          </span>
        )}
      </span>
      <span className="text-sm font-semibold opacity-50">{money(dish.catalogPrice)}</span>
      {dish.inMenu ? (
        <>
          <button
            onClick={() =>
              run(() => toggleAgotado({ dishId: dish.id, available: !dish.available, date }))
            }
            disabled={pending}
            className="rounded-full border border-ink/15 px-3 py-1.5 text-xs font-semibold"
          >
            {dish.available ? "Agotado" : "Disponible"}
          </button>
          <button
            onClick={() => run(() => quitarDelMenu({ dishId: dish.id, date }))}
            disabled={pending}
            className="rounded-full border border-coral/40 px-3 py-1.5 text-xs font-semibold text-coral"
          >
            Quitar
          </button>
        </>
      ) : (
        <button
          onClick={() => run(() => agregarAlMenu({ dishId: dish.id, price: dish.catalogPrice, date }))}
          disabled={pending}
          className="rounded-full bg-ink px-4 py-1.5 text-xs font-semibold text-white"
        >
          Agregar
        </button>
      )}
    </div>
  );
}

// Crear un combo desde el editor de menú: se eligen ≥2 ítems del catálogo
// (sopas, platos y/o adicionales), nombre opcional y precio. Si hay precio, el
// combo queda agregado al menú del día; si no, solo se crea en el catálogo.
function ComboForm({
  items,
  date,
  onDone,
}: {
  items: ComboItem[];
  date: string;
  onDone: () => void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const sopas = items.filter((d) => !d.isExtra && d.category === "sopa");
  const principales = items.filter((d) => !d.isExtra && d.category !== "sopa");
  const adicionales = items.filter((d) => d.isExtra);

  if (items.length < 2) {
    return (
      <div className="rounded-2xl bg-ink/[0.03] px-3 py-5 text-center text-sm opacity-60">
        Necesitas al menos 2 platos o adicionales en el catálogo para armar un combo.
      </div>
    );
  }

  const toggle = (id: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const roleOf = (d: ComboItem): "sopa" | "segundo" | "adicional" =>
    d.isExtra ? "adicional" : d.category === "sopa" ? "sopa" : "segundo";

  const crear = () => {
    setMsg(null);
    if (sel.size < 2) return setMsg("Elige al menos 2 ítems para el combo.");
    const parts = items
      .filter((d) => sel.has(d.id))
      .map((d) => ({ dishId: d.id, role: roleOf(d) }));
    start(async () => {
      const r = await crearComboEnMenu({
        parts,
        name: name.trim() || undefined,
        price: Number(price) || null,
        date,
      });
      if (r.error) setMsg(r.error);
      else onDone();
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-ink/10 bg-ink/[0.02] p-3">
      <p className="text-sm font-semibold">Nuevo combo</p>
      <p className="text-xs opacity-60">
        Marca lo que entra (mínimo 2). El costo se arma solo; con precio, queda agregado al menú.
      </p>
      <ComboPick title="Sopas" items={sopas} sel={sel} onToggle={toggle} />
      <ComboPick title="Platos" items={principales} sel={sel} onToggle={toggle} />
      <ComboPick title="Adicionales" items={adicionales} sel={sel} onToggle={toggle} />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nombre del combo (opcional)"
        className={`w-full ${inputCls}`}
      />
      <input
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        inputMode="decimal"
        placeholder="Precio del combo (ej. 2.50)"
        className={`w-full ${inputCls}`}
      />
      <div className="flex items-center gap-2">
        <button
          onClick={crear}
          disabled={pending}
          className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "Creando…" : `Crear combo${sel.size ? ` · ${sel.size}` : ""}`}
        </button>
        {msg && <span className="text-sm text-coral">{msg}</span>}
      </div>
    </div>
  );
}

// Chips seleccionables de un grupo de ítems para armar el combo.
function ComboPick({
  title,
  items,
  sel,
  onToggle,
}: {
  title: string;
  items: ComboItem[];
  sel: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide opacity-50">{title}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((d) => {
          const on = sel.has(d.id);
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => onToggle(d.id)}
              className={`rounded-full px-3 py-2 text-sm font-semibold transition ${
                on ? "bg-ink text-white" : "bg-ink/5"
              }`}
            >
              {d.name}
              <span className={`ml-1 text-xs font-normal ${on ? "text-white/70" : "opacity-40"}`}>
                {money(d.price)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CopyPanel({ date, onDone }: { date: string; onDone: () => void }) {
  const [from, setFrom] = useState(date);
  const [to, setTo] = useState(date);
  const [wds, setWds] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggleWd = (w: number) =>
    setWds((prev) => (prev.includes(w) ? prev.filter((x) => x !== w) : [...prev, w]));

  const submit = () => {
    setMsg(null);
    const dates = eachDate(from, to)
      .filter((d) => wds.includes(d.getDay()))
      .map(ymd);
    if (dates.length === 0)
      return setMsg("Ese rango no tiene días seleccionados (revisa fechas y días).");
    start(async () => {
      const r = await copiarMenu({ srcDate: date, dates });
      if (r.error) setMsg(r.error);
      else {
        setMsg(`✅ Copiado a ${r.count} día(s).`);
        setTimeout(onDone, 600);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-ink/10 bg-ink/[0.02] p-4">
      <p className="text-sm font-semibold">Copiar el menú de “{date}” a:</p>
      <div className="flex items-center gap-2 text-sm">
        <span className="opacity-60">Desde</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        <span className="opacity-60">hasta</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
      </div>
      <div className="flex items-center gap-1">
        {WD.map((l, w) => (
          <button
            key={w}
            onClick={() => toggleWd(w)}
            className={`h-8 w-8 rounded-full text-xs font-semibold ${
              wds.includes(w) ? "bg-ink text-white" : "border border-ink/15"
            }`}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={pending}
          className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-white"
        >
          {pending ? "Copiando…" : "Copiar"}
        </button>
        {msg && <span className="text-sm">{msg}</span>}
      </div>
    </div>
  );
}

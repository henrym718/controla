"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { Button, Card, Field, Input, PageTitle } from "@/components/ui";
import {
  crearPlato,
  armarCombo,
  crearAdicional,
  actualizarPlato,
  eliminarPlato,
  setReceta,
} from "../admin/actions";

interface Dish {
  id: string;
  name: string;
  price: number;
  active: boolean;
  isCombo: boolean;
  isExtra: boolean;
  category: string;
}
interface Part {
  comboId: string;
  partId: string;
  role: string;
}
interface Ingredient {
  id: string;
  name: string;
  kind: string;
  cost: number;
  stock: number | null;
}
interface Comp {
  dishId: string;
  ingredientId: string;
  qty: number;
}

const selectCls =
  "w-full rounded-2xl border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-ink/40";
const money = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;
const overlay =
  "fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center";
const sheet = "max-h-[92vh] w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-5";

export default function CatalogoClient({
  slug,
  dishes,
  parts,
  ingredients,
  components,
}: {
  slug: string;
  dishes: Dish[];
  parts: Part[];
  ingredients: Ingredient[];
  components: Comp[];
}) {
  const platos = dishes.filter((d) => !d.isCombo && !d.isExtra);
  const principales = platos.filter((d) => d.category !== "sopa");
  const sopas = platos.filter((d) => d.category === "sopa");
  const combos = dishes.filter((d) => d.isCombo);
  const adicionales = dishes.filter((d) => d.isExtra);
  const contables = ingredients.filter((i) => i.kind === "contable");

  const nameById = new Map(dishes.map((d) => [d.id, d.name]));
  const ROLE_ORDER: Record<string, number> = { sopa: 0, segundo: 1, adicional: 2 };
  const partsByCombo = new Map<string, { role: string; name: string }[]>();
  for (const p of parts) {
    const name = nameById.get(p.partId);
    if (!name) continue;
    const arr = partsByCombo.get(p.comboId) ?? [];
    arr.push({ role: p.role, name });
    partsByCombo.set(p.comboId, arr);
  }
  const recipeByDish = new Map<string, { ingredientId: string; qty: number }[]>();
  for (const c of components) {
    const arr = recipeByDish.get(c.dishId) ?? [];
    arr.push({ ingredientId: c.ingredientId, qty: c.qty });
    recipeByDish.set(c.dishId, arr);
  }

  const [recipeDish, setRecipeDish] = useState<Dish | null>(null);
  const [editDish, setEditDish] = useState<Dish | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [, start] = useTransition();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <PageTitle title="Catálogo" subtitle="Platos, combos y adicionales" />
        <button
          onClick={() => setShowAdd(true)}
          className="shrink-0 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white"
        >
          + Agregar
        </button>
      </div>

      {dishes.length === 0 && (
        <p className="rounded-2xl bg-ink/[0.03] px-4 py-8 text-center text-sm opacity-60">
          Aún no hay nada. Toca «+ Agregar» para crear tu primer plato.
        </p>
      )}

      <Section title="Platos principales" count={principales.length}>
        {principales.map((d) => (
          <DishCard
            key={d.id}
            dish={d}
            recipeCount={(recipeByDish.get(d.id) ?? []).length}
            onRecipe={() => setRecipeDish(d)}
            onEdit={() => setEditDish(d)}
            start={start}
          />
        ))}
      </Section>

      <Section title="Sopas" count={sopas.length}>
        {sopas.map((d) => (
          <DishCard
            key={d.id}
            dish={d}
            recipeCount={(recipeByDish.get(d.id) ?? []).length}
            onRecipe={() => setRecipeDish(d)}
            onEdit={() => setEditDish(d)}
            start={start}
          />
        ))}
      </Section>

      {combos.length > 0 && (
        <Section title="Combos" count={combos.length}>
          {combos.map((d) => {
            const pr = partsByCombo.get(d.id);
            const sub = pr
              ? pr
                  .slice()
                  .sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9))
                  .map((x) => x.name)
                  .join(" + ")
              : undefined;
            return (
              <DishCard key={d.id} dish={d} subtitle={sub} onEdit={() => setEditDish(d)} start={start} />
            );
          })}
        </Section>
      )}

      {adicionales.length > 0 && (
        <Section title="Adicionales" count={adicionales.length}>
          {adicionales.map((d) => (
            <DishCard
              key={d.id}
              dish={d}
              recipeCount={(recipeByDish.get(d.id) ?? []).length}
              onRecipe={() => setRecipeDish(d)}
              onEdit={() => setEditDish(d)}
              start={start}
            />
          ))}
        </Section>
      )}

      {showAdd && (
        <AddCatalogModal
          platos={platos}
          adicionales={adicionales}
          contables={contables}
          onClose={() => setShowAdd(false)}
        />
      )}
      {recipeDish && (
        <RecipeModal
          dish={recipeDish}
          ingredients={ingredients}
          current={recipeByDish.get(recipeDish.id) ?? []}
          onClose={() => setRecipeDish(null)}
        />
      )}
      {editDish && (
        <EditDishModal dish={editDish} slug={slug} onClose={() => setEditDish(null)} />
      )}
    </div>
  );
}

// =========================================================================== Modal "Agregar" con tabs
type AddTab = "plato" | "combo" | "adicional";

function AddCatalogModal({
  platos,
  adicionales,
  contables,
  onClose,
}: {
  platos: Dish[];
  adicionales: Dish[];
  contables: Ingredient[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<AddTab>("plato");
  const TABS: { id: AddTab; label: string }[] = [
    { id: "plato", label: "Plato" },
    { id: "combo", label: "Combo" },
    { id: "adicional", label: "Adicional" },
  ];

  return (
    <div className={overlay}>
      <div className={sheet}>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-lg font-bold">Agregar al catálogo</p>
          <button onClick={onClose} className="text-sm font-semibold opacity-50">
            Cerrar
          </button>
        </div>

        <div className="mb-4 flex gap-1 rounded-full bg-ink/5 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold transition ${
                tab === t.id ? "bg-ink text-white" : "opacity-60"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "plato" && <FormPlato onDone={onClose} />}
        {tab === "combo" && (
          <FormCombo platos={platos} adicionales={adicionales} onDone={onClose} />
        )}
        {tab === "adicional" && <FormAdicional contables={contables} onDone={onClose} />}
      </div>
    </div>
  );
}

// Selector de categoría del plato (principal / sopa)
function CategoryPicker({
  value,
  onChange,
}: {
  value: "principal" | "sopa";
  onChange: (v: "principal" | "sopa") => void;
}) {
  return (
    <Field label="Tipo de plato">
      <div className="flex gap-2">
        {(
          [
            ["principal", "Plato principal"],
            ["sopa", "Sopa"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={`flex-1 rounded-full px-3 py-2 text-sm font-semibold ${
              value === v ? "bg-ink text-white" : "bg-ink/5"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </Field>
  );
}

// --------------------------------------------------------------------------- Form: Plato
function FormPlato({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState<"principal" | "sopa">("principal");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const crear = () => {
    setMsg(null);
    const p = Number(price);
    if (!name.trim() || !p) return setMsg("Completa nombre y precio.");
    start(async () => {
      const r = await crearPlato({ name: name.trim(), price: p, category });
      if (r.error) setMsg(r.error);
      else onDone();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm opacity-60">Un plato individual (luego le pones su receta).</p>
      <CategoryPicker value={category} onChange={setCategory} />
      <Field label="Nombre">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Seco de pollo, Sopa de bola…" />
      </Field>
      <Field label="Precio individual">
        <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0.00" />
      </Field>
      <Button onClick={crear} disabled={pending}>
        {pending ? "Guardando…" : "Crear plato"}
      </Button>
      {msg && <p className="text-center text-sm text-coral">{msg}</p>}
    </div>
  );
}

// --------------------------------------------------------------------------- Form: Combo
//  Un combo une 2+ ítems del catálogo: sopas, platos principales y/o
//  ADICIONALES. El rol se deduce del ítem (sopa / segundo / adicional). La
//  receta y el costo se suman solos; el precio del día se fija en el menú.
function FormCombo({
  platos,
  adicionales,
  onDone,
}: {
  platos: Dish[];
  adicionales: Dish[];
  onDone: () => void;
}) {
  const sopas = platos.filter((d) => d.category === "sopa");
  const principales = platos.filter((d) => d.category !== "sopa");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (platos.length + adicionales.length < 2) {
    return (
      <p className="rounded-2xl bg-ink/[0.03] px-3 py-6 text-center text-sm opacity-60">
        Crea al menos dos ítems (platos o adicionales) y aquí podrás unirlos en un combo.
      </p>
    );
  }

  const toggle = (id: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const roleOf = (d: Dish): "sopa" | "segundo" | "adicional" =>
    d.isExtra ? "adicional" : d.category === "sopa" ? "sopa" : "segundo";

  const crear = () => {
    setMsg(null);
    if (sel.size < 2) return setMsg("Elige al menos 2 ítems para el combo.");
    const parts = [...platos, ...adicionales]
      .filter((d) => sel.has(d.id))
      .map((d) => ({ dishId: d.id, role: roleOf(d) }));
    start(async () => {
      const r = await armarCombo({
        parts,
        name: name.trim() || undefined,
        price: Number(price) || null,
      });
      if (r.error) setMsg(r.error);
      else onDone();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm opacity-60">
        Marca lo que entra al combo (mínimo 2). Puedes mezclar platos y adicionales; la receta y el
        costo se arman solos y el precio del día va en el menú.
      </p>

      <ComboPick title="Sopas" items={sopas} sel={sel} onToggle={toggle} />
      <ComboPick title="Platos principales" items={principales} sel={sel} onToggle={toggle} />
      <ComboPick title="Adicionales" items={adicionales} sel={sel} onToggle={toggle} />

      <Field label="Nombre del combo (opcional)">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Combo del día" />
      </Field>
      <Field label="Precio combo sugerido (opcional)">
        <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="2.50" />
      </Field>
      <Button onClick={crear} disabled={pending}>
        {pending ? "Armando…" : `Armar combo${sel.size ? ` · ${sel.size}` : ""}`}
      </Button>
      {msg && <p className="text-center text-sm text-coral">{msg}</p>}
    </div>
  );
}

// Grupo de ítems seleccionables (chips) para armar el combo.
function ComboPick({
  title,
  items,
  sel,
  onToggle,
}: {
  title: string;
  items: Dish[];
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

// --------------------------------------------------------------------------- Form: Adicional
function FormAdicional({ contables, onDone }: { contables: Ingredient[]; onDone: () => void }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [ingredient, setIngredient] = useState("");
  const [qty, setQty] = useState("1");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const crear = () => {
    setMsg(null);
    const p = Number(price);
    if (!name.trim() || !p) return setMsg("Completa nombre y precio.");
    start(async () => {
      const r = await crearAdicional({
        name: name.trim(),
        price: p,
        ingredientId: ingredient || null,
        qty: Number(qty) || 1,
      });
      if (r.error) setMsg(r.error);
      else onDone();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm opacity-60">
        Un extra que se cobra aparte (huevo, porción). Si eliges el insumo que gasta, se descuenta solo.
      </p>
      <Field label="Nombre">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Huevo extra, Porción de papa…" />
      </Field>
      <Field label="Precio">
        <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0.50" />
      </Field>
      <Field label="Insumo que gasta (opcional)">
        <select className={selectCls} value={ingredient} onChange={(e) => setIngredient(e.target.value)}>
          <option value="">Ninguno (solo ingreso)</option>
          {contables.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </Field>
      {ingredient && (
        <Field label="¿Cuántas unidades de ese insumo gasta?">
          <Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" placeholder="1" />
        </Field>
      )}
      <Button onClick={crear} disabled={pending}>
        {pending ? "Guardando…" : "Crear adicional"}
      </Button>
      {msg && <p className="text-center text-sm text-coral">{msg}</p>}
    </div>
  );
}

// --------------------------------------------------------------------------- Editar plato
function EditDishModal({ dish, slug, onClose }: { dish: Dish; slug: string; onClose: () => void }) {
  const isPlato = !dish.isCombo && !dish.isExtra;
  const [name, setName] = useState(dish.name);
  const [price, setPrice] = useState(String(dish.price));
  const [active, setActive] = useState(dish.active);
  const [category, setCategory] = useState<"principal" | "sopa">(
    dish.category === "sopa" ? "sopa" : "principal",
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () => {
    setMsg(null);
    if (!name.trim() || !(Number(price) > 0)) return setMsg("Completa nombre y precio.");
    start(async () => {
      const r = await actualizarPlato(dish.id, {
        name: name.trim(),
        price: Number(price),
        active,
        category: isPlato ? category : undefined,
      });
      if (r.error) setMsg(r.error);
      else onClose();
    });
  };

  return (
    <div className={overlay}>
      <div className="w-full max-w-sm rounded-3xl bg-white p-5">
        <p className="text-lg font-bold">
          Editar {dish.isCombo ? "combo" : dish.isExtra ? "adicional" : "plato"}
        </p>
        <div className="mt-3 flex flex-col gap-3">
          <Field label="Nombre">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Precio individual">
            <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
          </Field>
          {isPlato && <CategoryPicker value={category} onChange={setCategory} />}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4"
            />
            Activo (aparece en el menú y catálogo)
          </label>
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={pending}
              className="flex-1 rounded-full bg-ink py-3 font-semibold text-white"
            >
              {pending ? "Guardando…" : "Guardar"}
            </button>
            <button onClick={onClose} className="rounded-full border border-ink/15 px-5 py-3 font-semibold">
              Cerrar
            </button>
          </div>
          <Link
            href={`/${slug}/historico?dish=${dish.id}`}
            className="text-center text-sm font-medium underline opacity-70"
          >
            Ver historial de costo
          </Link>
          {msg && <p className="text-center text-sm text-coral">{msg}</p>}
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- Receta (buscador)
function RecipeModal({
  dish,
  ingredients,
  current,
  onClose,
}: {
  dish: Dish;
  ingredients: Ingredient[];
  current: { ingredientId: string; qty: number }[];
  onClose: () => void;
}) {
  const [rows, setRows] = useState<{ ingredientId: string; qty: number }[]>(current);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const used = new Set(rows.map((r) => r.ingredientId));
  const matches = search.trim()
    ? ingredients
        .filter((i) => !used.has(i.id) && i.name.toLowerCase().includes(search.trim().toLowerCase()))
        .slice(0, 6)
    : [];

  const directo = rows.reduce((s, r) => {
    const ing = byId.get(r.ingredientId);
    return s + (ing && ing.kind === "contable" ? ing.cost * r.qty : 0);
  }, 0);

  const add = (id: string) => {
    setRows((r) => [...r, { ingredientId: id, qty: 1 }]);
    setSearch("");
  };
  const removeRow = (id: string) => setRows((r) => r.filter((x) => x.ingredientId !== id));
  const setQty = (id: string, q: number) =>
    setRows((r) => r.map((x) => (x.ingredientId === id ? { ...x, qty: q } : x)));

  const save = () => {
    setMsg(null);
    start(async () => {
      const r = await setReceta(
        dish.id,
        rows.filter((x) => x.qty > 0),
      );
      if (r.error) setMsg(r.error);
      else onClose();
    });
  };

  return (
    <div className={overlay}>
      <div className={sheet}>
        <p className="text-lg font-bold">Receta · {dish.name}</p>
        <p className="mb-3 text-xs opacity-50">
          Qué consume este plato. Lo contable (proteína, pan…) se descuenta al vender; lo de granel
          (arroz, sopa) marca que participa de ese pool.
        </p>

        <div className="flex flex-col gap-2">
          {rows.length === 0 && (
            <p className="rounded-2xl bg-ink/[0.03] px-3 py-4 text-center text-sm opacity-50">
              Aún no lleva nada. Búscalo abajo y agrégalo.
            </p>
          )}
          {rows.map((r) => {
            const ing = byId.get(r.ingredientId);
            const granel = ing?.kind === "granel";
            return (
              <div
                key={r.ingredientId}
                className="flex items-center gap-2 rounded-2xl border border-ink/10 px-3 py-2"
              >
                <span className="min-w-0 flex-1 text-sm font-medium">
                  <span className="truncate">{ing?.name ?? "—"}</span>
                  <span
                    className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      granel ? "bg-sand" : "bg-mint"
                    }`}
                  >
                    {granel ? "granel" : "directo"}
                  </span>
                  {ing && !granel && (
                    <span className="ml-1 text-[11px] opacity-50">
                      {money(ing.cost)}
                      {ing.stock != null ? ` · ${ing.stock} u` : ""}
                    </span>
                  )}
                </span>
                <input
                  inputMode="decimal"
                  value={String(r.qty)}
                  onChange={(e) => setQty(r.ingredientId, Number(e.target.value) || 0)}
                  className="w-16 rounded-xl border border-ink/15 px-2 py-1 text-right text-sm outline-none focus:border-ink/40"
                />
                <button
                  onClick={() => removeRow(r.ingredientId)}
                  className="rounded-full bg-coral/10 px-3 py-1 text-xs font-semibold text-coral"
                >
                  Quitar
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar insumo del inventario…"
            className="w-full rounded-2xl border border-ink/15 px-3 py-2.5 text-sm outline-none focus:border-ink/40"
          />
          {matches.length > 0 && (
            <div className="mt-1 flex flex-col overflow-hidden rounded-2xl border border-ink/10">
              {matches.map((i) => (
                <button
                  key={i.id}
                  onClick={() => add(i.id)}
                  className="flex items-center justify-between gap-2 border-b border-ink/5 px-3 py-2 text-left text-sm last:border-0 hover:bg-ink/[0.03]"
                >
                  <span className="min-w-0 truncate font-medium">{i.name}</span>
                  <span className="shrink-0 text-xs opacity-50">
                    {i.kind === "granel"
                      ? "granel"
                      : `${money(i.cost)}${i.stock != null ? ` · ${i.stock} u` : ""}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <p className="mt-3 text-center text-xs opacity-60">
          Costo directo de la receta: <span className="font-bold">{money(directo)}</span>
          <span className="opacity-50"> (+ lo de granel se reparte al cierre)</span>
        </p>

        <div className="mt-3 flex gap-2">
          <button
            onClick={save}
            disabled={pending}
            className="flex-1 rounded-full bg-ink py-3 font-semibold text-white"
          >
            {pending ? "Guardando…" : "Guardar receta"}
          </button>
          <button onClick={onClose} className="rounded-full border border-ink/15 px-5 py-3 font-semibold">
            Cerrar
          </button>
        </div>
        {msg && <p className="mt-2 text-center text-sm text-coral">{msg}</p>}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- Helpers de lista
function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide opacity-50">
        {title} · {count}
      </p>
      {children}
    </div>
  );
}

function DishCard({
  dish,
  subtitle,
  recipeCount,
  onRecipe,
  onEdit,
  start,
}: {
  dish: Dish;
  subtitle?: string;
  recipeCount?: number;
  onRecipe?: () => void;
  onEdit: () => void;
  start: (fn: () => void) => void;
}) {
  return (
    <Card className={dish.active ? "" : "opacity-50"}>
      <div className="flex items-center justify-between gap-2">
        <button onClick={onEdit} className="min-w-0 flex-1 text-left">
          <p className="truncate font-semibold">
            {dish.name}
            <span className="ml-1 text-xs font-normal opacity-40">· editar</span>
          </p>
          {subtitle ? (
            <p className="truncate text-xs opacity-60">{subtitle}</p>
          ) : (
            <p className="text-xs opacity-60">{money(dish.price)}</p>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {onRecipe && (
            <button onClick={onRecipe} className="rounded-full bg-lav px-4 py-2 text-sm font-semibold">
              Receta{recipeCount ? ` · ${recipeCount}` : ""}
            </button>
          )}
          <button
            onClick={() => {
              if (window.confirm(`¿Quitar ${dish.name}?`)) start(() => void eliminarPlato(dish.id));
            }}
            className="rounded-full bg-coral/10 px-4 py-2 text-sm font-semibold text-coral"
          >
            Quitar
          </button>
        </div>
      </div>
    </Card>
  );
}

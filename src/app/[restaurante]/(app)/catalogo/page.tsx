import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import CatalogoClient from "./catalogo-client";

export default async function CatalogoPage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);
  if (session.user_role !== "admin") redirect(`/${restaurante}/hoy`);

  const db = createAdminClient();
  const [
    { data: dishes },
    { data: parts },
    { data: ingredients },
    { data: components },
    { data: stock },
  ] = await Promise.all([
    db
      .from("dishes")
      .select("id,name,price,active,is_combo,is_extra,category")
      .eq("restaurant_id", session.restaurant_id)
      .order("name"),
    db
      .from("combo_parts")
      .select("combo_dish_id,part_dish_id,role")
      .eq("restaurant_id", session.restaurant_id),
    db
      .from("ingredients")
      .select("id,name,kind,last_unit_cost")
      .eq("restaurant_id", session.restaurant_id)
      .eq("active", true)
      .order("name"),
    db
      .from("dish_components")
      .select("dish_id,ingredient_id,qty")
      .eq("restaurant_id", session.restaurant_id),
    db
      .from("v_stock_contable")
      .select("ingredient_id,stock")
      .eq("restaurant_id", session.restaurant_id),
  ]);

  const stockById = new Map(
    (stock ?? []).map((s) => [s.ingredient_id, Number(s.stock ?? 0)]),
  );

  return (
    <CatalogoClient
      slug={restaurante}
      dishes={(dishes ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        price: Number(d.price),
        active: d.active,
        isCombo: d.is_combo,
        isExtra: d.is_extra,
        category: d.category ?? "principal",
      }))}
      parts={(parts ?? []).map((p) => ({
        comboId: p.combo_dish_id,
        partId: p.part_dish_id,
        role: p.role,
      }))}
      ingredients={(ingredients ?? []).map((i) => ({
        id: i.id,
        name: i.name,
        kind: i.kind,
        cost: Number(i.last_unit_cost ?? 0),
        stock: stockById.get(i.id) ?? null,
      }))}
      components={(components ?? []).map((c) => ({
        dishId: c.dish_id,
        ingredientId: c.ingredient_id,
        qty: Number(c.qty),
      }))}
    />
  );
}

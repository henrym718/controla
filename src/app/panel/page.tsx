import { redirect } from "next/navigation";
import { getSuper } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import PanelClient, { type RestaurantRow } from "./panel-client";

export default async function PanelPage() {
  if (!(await getSuper())) redirect("/panel/login");

  const db = createAdminClient();
  const [{ data: rests }, { data: users }] = await Promise.all([
    db.from("restaurants").select("id,slug,name,active").order("created_at"),
    db
      .from("users")
      .select("id,name,role,active,restaurant_id")
      .order("name"),
  ]);

  const restaurants: RestaurantRow[] = (rests ?? []).map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    active: r.active,
    users: (users ?? [])
      .filter((u) => u.restaurant_id === r.id)
      .map((u) => ({ id: u.id, name: u.name, role: u.role, active: u.active })),
  }));

  return <PanelClient restaurants={restaurants} />;
}

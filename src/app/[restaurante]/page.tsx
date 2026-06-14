import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDate } from "@/lib/shifts";
import LoginForm from "./login-form";

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ restaurante: string }>;
  searchParams: Promise<{ cerrado?: string }>;
}) {
  const { restaurante } = await params;
  const { cerrado } = await searchParams;

  const db = createAdminClient();
  const { data: rest } = await db
    .from("restaurants")
    .select("id,name,slug")
    .eq("slug", restaurante)
    .eq("active", true)
    .maybeSingle();
  if (!rest) notFound();

  const [{ data: shifts }, { data: openSessions }] = await Promise.all([
    db
      .from("shifts")
      .select("id,name,start_time,end_time")
      .eq("restaurant_id", rest.id)
      .eq("active", true)
      .order("sort_order"),
    db
      .from("shift_sessions")
      .select("shift_id")
      .eq("restaurant_id", rest.id)
      .eq("business_date", businessDate())
      .eq("status", "open"),
  ]);

  return (
    <LoginForm
      slug={rest.slug}
      name={rest.name}
      shifts={shifts ?? []}
      openShiftIds={(openSessions ?? []).map((s) => s.shift_id)}
      closedNotice={cerrado === "1" || cerrado === "error"}
    />
  );
}

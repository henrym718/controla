import { redirect } from "next/navigation";
import { getSuper } from "@/lib/auth/session";
import SuperLogin from "./super-login";

export default async function PanelLoginPage() {
  if (await getSuper()) redirect("/panel");
  return <SuperLogin />;
}

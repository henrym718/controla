import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import GastosClient from "./gastos-client";

export default async function GastosPage({
  params,
}: {
  params: Promise<{ restaurante: string }>;
}) {
  const { restaurante } = await params;
  const session = await getSession();
  if (!session) redirect(`/${restaurante}`);

  return <GastosClient slug={restaurante} />;
}

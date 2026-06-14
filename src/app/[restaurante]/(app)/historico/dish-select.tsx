"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

export function DishSelect({
  dishes,
  current,
}: {
  dishes: { id: string; name: string }[];
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  return (
    <select
      value={current}
      onChange={(e) => {
        const q = new URLSearchParams(sp.toString());
        q.set("dish", e.target.value);
        router.push(`${pathname}?${q.toString()}`);
      }}
      className="w-full rounded-2xl border border-ink/15 bg-white px-4 py-3 text-base outline-none focus:border-ink/40"
    >
      <option value="">Elige un plato…</option>
      {dishes.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  );
}

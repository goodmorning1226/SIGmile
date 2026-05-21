"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/** 列出最近 6 季 + 給主管挑。例如 2026Q3 / 2026Q2 / ... */
function recentQuarters(now: Date = new Date(), n = 6): string[] {
  const out: string[] = [];
  let y = now.getUTCFullYear();
  let q = Math.floor(now.getUTCMonth() / 3) + 1;
  for (let i = 0; i < n; i++) {
    out.push(`${y}Q${q}`);
    q--;
    if (q === 0) { q = 4; y--; }
  }
  return out;
}

export function QuarterSelector({ current }: { current: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const options = recentQuarters();
  if (!options.includes(current)) options.unshift(current);

  return (
    <div className="flex items-center gap-2">
      {pending && <Loader2 className="size-3.5 animate-spin text-slate-400" />}
      <select
        value={current}
        onChange={(e) => {
          const v = e.target.value;
          startTransition(() => {
            router.push(`/quarterly-analysis?q=${v}`, { scroll: false });
          });
        }}
        className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
      >
        {options.map((q) => (
          <option key={q} value={q}>{q}</option>
        ))}
      </select>
    </div>
  );
}

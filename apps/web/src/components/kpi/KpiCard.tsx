import { cn } from "@/lib/utils/cn";

export interface KpiCardProps {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
  icon?: React.ReactNode;
}

const TONE_RING: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  default: "ring-slate-200",
  good:    "ring-accent-200",
  warn:    "ring-amber-200",
  bad:     "ring-red-200"
};

const TONE_DOT: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  default: "bg-slate-300",
  good:    "bg-accent-500",
  warn:    "bg-amber-500",
  bad:     "bg-red-500"
};

export function KpiCard({ label, value, hint, tone = "default", icon }: KpiCardProps) {
  return (
    <div
      className={cn(
        "relative rounded-xl border border-slate-200 bg-white p-5 shadow-card ring-1",
        TONE_RING[tone]
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
          <span className={cn("size-1.5 rounded-full", TONE_DOT[tone])} />
          {label}
        </div>
        {icon && <div className="text-slate-400">{icon}</div>}
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
        {value}
      </div>
      {hint && (
        <div className="mt-1 text-xs text-slate-500">{hint}</div>
      )}
    </div>
  );
}

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  info:    "bg-blue-100 text-blue-700",
  success: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-800",
  danger:  "bg-red-100 text-red-700"
};

export function Badge({
  tone = "neutral", className, ...p
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        TONE[tone], className
      )}
      {...p}
    />
  );
}

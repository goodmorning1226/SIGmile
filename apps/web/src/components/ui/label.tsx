import * as React from "react";
import { cn } from "@/lib/utils/cn";

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium text-slate-700", className)} {...p} />;
}

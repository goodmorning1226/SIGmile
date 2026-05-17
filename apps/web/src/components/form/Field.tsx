import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface FieldProps {
  label: string;
  hint?: string;
  required?: boolean;
  suffix?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** 統一的表單欄位包裝：label + 輸入 + suffix + 提示文字 */
export function Field({ label, hint, required, suffix, children, className }: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <div className="flex items-center gap-2">
        <div className="flex-1">{children}</div>
        {suffix && (
          <span className="shrink-0 text-sm text-slate-500">{suffix}</span>
        )}
      </div>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

/** 表單分組標題，例如「服務時間相關」 */
export function FieldGroup({
  title,
  description,
  children
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50/30 p-4">
      <div className="mb-3">
        <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
        {description && (
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

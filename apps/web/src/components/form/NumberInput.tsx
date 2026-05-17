"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface NumberInputProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/** 純數字輸入，自動防呆 NaN，空字串視為 0。 */
export function NumberInput({
  value, onChange, min, max, step, placeholder, disabled, className
}: NumberInputProps) {
  const [text, setText] = React.useState<string>(String(value ?? 0));
  React.useEffect(() => {
    setText(String(value ?? 0));
  }, [value]);

  return (
    <input
      type="number"
      inputMode="decimal"
      value={text}
      min={min}
      max={max}
      step={step ?? 1}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        if (next.trim() === "") {
          onChange(0);
          return;
        }
        const n = Number(next);
        if (!Number.isNaN(n)) onChange(n);
      }}
      className={cn(
        "h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm",
        "focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500",
        "disabled:bg-slate-50 disabled:text-slate-500",
        className
      )}
    />
  );
}

/**
 * 百分比輸入：UI 顯示 0–100，底層儲存 0–1。
 */
export function PercentInput({
  value, onChange, min = 0, max = 100, step = 1, disabled, className
}: Omit<NumberInputProps, "value" | "onChange"> & {
  value: number;
  onChange: (v: number) => void;
}) {
  const display = Math.round((value ?? 0) * 100 * 10) / 10;
  return (
    <NumberInput
      value={display}
      onChange={(v) => onChange(Math.max(0, Math.min(100, v)) / 100)}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={className}
    />
  );
}

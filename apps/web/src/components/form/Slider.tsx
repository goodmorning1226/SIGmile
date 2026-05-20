"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

export interface SliderProps {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  /** 顯示在右側的單位文字 */
  suffix?: string;
  /** 自訂顯示文字（覆寫 value 顯示） */
  display?: (v: number) => string;
}

/** 一條乾淨的 range slider + 右側顯示目前值。 */
export function Slider({
  value, onChange, min, max, step = 1, disabled, className, suffix, display
}: SliderProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn(
          "h-2 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200",
          "[&::-webkit-slider-thumb]:appearance-none",
          "[&::-webkit-slider-thumb]:size-4",
          "[&::-webkit-slider-thumb]:rounded-full",
          "[&::-webkit-slider-thumb]:bg-brand-600",
          "[&::-webkit-slider-thumb]:shadow",
          "[&::-webkit-slider-thumb]:transition",
          "[&::-webkit-slider-thumb]:hover:scale-110",
          "[&::-moz-range-thumb]:size-4",
          "[&::-moz-range-thumb]:rounded-full",
          "[&::-moz-range-thumb]:bg-brand-600",
          "[&::-moz-range-thumb]:border-0",
          disabled && "cursor-not-allowed opacity-50"
        )}
      />
      <div className="min-w-[64px] text-right text-sm font-semibold tabular-nums text-slate-800">
        {display ? display(value) : value}
        {suffix && <span className="ml-0.5 text-xs font-normal text-slate-500">{suffix}</span>}
      </div>
    </div>
  );
}

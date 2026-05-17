"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface TagsInputProps {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/** 輸入後按 Enter / 逗號加入；按 Backspace 刪除最後一個。 */
export function TagsInput({
  value, onChange, placeholder, disabled, className
}: TagsInputProps) {
  const [text, setText] = React.useState("");

  const add = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (value.includes(t)) {
      setText("");
      return;
    }
    onChange([...value, t]);
    setText("");
  };

  const remove = (idx: number) => {
    const next = [...value];
    next.splice(idx, 1);
    onChange(next);
  };

  return (
    <div
      className={cn(
        "flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1.5",
        "focus-within:ring-2 focus-within:ring-brand-500/30 focus-within:border-brand-500",
        disabled && "bg-slate-50",
        className
      )}
    >
      {value.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700"
        >
          {tag}
          {!disabled && (
            <button
              type="button"
              className="text-brand-500 hover:text-brand-700"
              onClick={() => remove(i)}
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
      <input
        type="text"
        value={text}
        disabled={disabled}
        placeholder={value.length === 0 ? placeholder : ""}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(text);
          } else if (e.key === "Backspace" && !text && value.length > 0) {
            e.preventDefault();
            remove(value.length - 1);
          }
        }}
        onBlur={() => add(text)}
        className="min-w-[80px] flex-1 border-none bg-transparent text-sm outline-none placeholder:text-slate-400"
      />
    </div>
  );
}

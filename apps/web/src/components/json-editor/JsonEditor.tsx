"use client";

import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils/cn";

export interface JsonEditorProps {
  value: unknown;
  onChange: (value: unknown, raw: string, valid: boolean) => void;
  rows?: number;
  className?: string;
  placeholder?: string;
}

/**
 * 極簡 JSON 編輯器：textarea + 即時驗證 + pretty-print。
 * MVP 後可換成 monaco-editor。
 */
export function JsonEditor({ value, onChange, rows = 10, className, placeholder }: JsonEditorProps) {
  const [raw, setRaw] = React.useState(() => safeStringify(value));
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    // 外部 value 變更時同步（例如 fetch 完）
    setRaw(safeStringify(value));
    setError(null);
  }, [value]);

  const handle = (next: string) => {
    setRaw(next);
    try {
      const parsed = next.trim() === "" ? {} : JSON.parse(next);
      setError(null);
      onChange(parsed, next, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
      onChange(undefined, next, false);
    }
  };

  return (
    <div className={cn("space-y-1", className)}>
      <Textarea
        value={raw}
        rows={rows}
        spellCheck={false}
        placeholder={placeholder ?? "{}"}
        onChange={(e) => handle(e.target.value)}
      />
      {error ? (
        <p className="text-xs text-red-600">JSON 解析錯誤：{error}</p>
      ) : (
        <p className="text-xs text-slate-400">JSON 已驗證</p>
      )}
    </div>
  );
}

function safeStringify(v: unknown) {
  try { return JSON.stringify(v ?? {}, null, 2); } catch { return "{}"; }
}

"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload, Check, X, Database } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ImportResult {
  inserted: number;
  updated: number;
  total_rows: number;
  errors: string[];
}

/**
 * 「停靠點資料管理」面板：
 *   - 下載目前所有 stops 為 xlsx（中文標頭）
 *   - 上傳 xlsx 進來做 upsert（依 external_code 或 name+address 比對）
 */
export function StopsExcelPanel({ totalStops }: { totalStops: number }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const downloadExcel = () => {
    // 直接 navigate 觸發下載
    window.location.href = "/api/manager/stops/export";
  };

  const onPickFile = () => fileRef.current?.click();

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    setResult(null);

    startTransition(async () => {
      try {
        const form = new FormData();
        form.append("file", f);
        const res = await fetch("/api/manager/stops/import", {
          method: "POST",
          body: form
        });
        const j = await res.json();
        if (!j.ok) throw new Error(j.error?.message ?? "匯入失敗");
        setResult(j.data as ImportResult);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "未知錯誤");
      } finally {
        if (fileRef.current) fileRef.current.value = "";
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Database className="size-4 text-brand-500" />
          目前共 <strong className="text-slate-900">{totalStops}</strong> 個停靠點
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={downloadExcel}>
            <Download className="size-3.5" />
            下載 Excel
          </Button>
          <Button size="sm" onClick={onPickFile} loading={pending}>
            <Upload className="size-3.5" />
            上傳 Excel
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={onFileChange}
          />
        </div>
      </div>

      {result && (
        <div className="rounded-md border border-accent-200 bg-accent-50 p-3 text-sm">
          <div className="flex items-center gap-1.5 text-accent-800 font-medium">
            <Check className="size-4" /> 匯入完成
          </div>
          <div className="mt-1 text-xs text-slate-700">
            共 {result.total_rows} 列 ·{" "}
            新增 <strong>{result.inserted}</strong> 個 ·{" "}
            更新 <strong>{result.updated}</strong> 個
            {result.errors.length > 0 && (
              <> · 失敗 <strong className="text-red-600">{result.errors.length}</strong> 列</>
            )}
          </div>
          {result.errors.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-slate-500">
                查看錯誤明細
              </summary>
              <ul className="mt-1 list-disc pl-5 text-xs text-red-700">
                {result.errors.slice(0, 5).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
                {result.errors.length > 5 && <li>… 還有 {result.errors.length - 5} 筆</li>}
              </ul>
            </details>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
          <div className="flex items-center gap-1.5 text-red-700 font-medium">
            <X className="size-4" /> 匯入失敗
          </div>
          <p className="mt-1 text-xs text-slate-700">{error}</p>
        </div>
      )}
    </div>
  );
}

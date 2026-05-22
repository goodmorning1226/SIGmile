"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Upload, Check, X, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ImportResult {
  total_rows: number;
  created_count: number;
  updated_count: number;
  created: Array<{ email: string; password: string }>;
  updated_emails: string[];
  errors: string[];
}

/**
 * 物流士主檔 Excel I/O：下載目前所有 driver、上傳 xlsx 批次新增/更新。
 * 新建司機的初始密碼會列在結果區，主管可一次複製。
 */
export function DriversExcelPanel() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const downloadExcel = () => {
    window.location.href = "/api/manager/drivers/export";
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
        const res = await fetch("/api/manager/drivers/import", {
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

  const copyAllPasswords = async () => {
    if (!result || result.created.length === 0) return;
    const text = result.created.map((c) => `${c.email}\t${c.password}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
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

      {result && (
        <div className="rounded-md border border-accent-200 bg-accent-50 p-3 text-sm">
          <div className="flex items-center gap-1.5 text-accent-800 font-medium">
            <Check className="size-4" /> 匯入完成
          </div>
          <div className="mt-1 text-xs text-slate-700">
            共 {result.total_rows} 列 ·
            新增 <strong>{result.created_count}</strong> 位 ·
            更新 <strong>{result.updated_count}</strong> 位
            {result.errors.length > 0 && (
              <> · 失敗 <strong className="text-red-600">{result.errors.length}</strong> 列</>
            )}
          </div>

          {result.created.length > 0 && (
            <div className="mt-3 rounded border border-amber-300 bg-white p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-amber-900">
                  ⚠️ 新建物流士的初始密碼（離開此頁就看不到）
                </div>
                <button
                  onClick={copyAllPasswords}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                >
                  <Copy className="size-3" /> 全部複製
                </button>
              </div>
              <table className="mt-2 w-full text-xs">
                <thead className="text-left text-slate-500">
                  <tr><th className="pr-3 pb-1">Email</th><th className="pb-1">密碼</th></tr>
                </thead>
                <tbody className="font-mono text-slate-800">
                  {result.created.map((c) => (
                    <tr key={c.email}>
                      <td className="pr-3 py-0.5">{c.email}</td>
                      <td className="py-0.5">{c.password}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.errors.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-slate-500">
                查看錯誤明細
              </summary>
              <ul className="mt-1 list-disc pl-5 text-xs text-red-700">
                {result.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
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

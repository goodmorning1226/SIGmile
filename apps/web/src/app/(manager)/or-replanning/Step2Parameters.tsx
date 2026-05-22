"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OrInputForm, DEFAULT_OR_INPUT, type OrInputParams } from "./OrInputForm";

/**
 * 步驟 2 · 規劃參數
 *  - 直接呈現 OR 求解參數（過去藏在「建立新規劃任務」對話框裡，現在攤平到頁面）
 *  - 按下「建立試算任務」會帶這些參數送出去 /api/manager/or-jobs
 *  - σ (服務時間) / q (站點需求) 已轉到「季度分析」由 AI 預測，這裡不再顯示
 */
export function Step2Parameters({
  periodId,
  periodLabel
}: {
  periodId: string;
  periodLabel: string;
}) {
  const router = useRouter();
  const [params, setParams] = useState<OrInputParams>(DEFAULT_OR_INPUT);
  const [pending, startTransition] = useTransition();
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/manager/or-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planning_period_id: periodId, input_parameters: params })
      });
      const j = await res.json();
      if (!j.ok) {
        setError(j.error?.message ?? "建立失敗");
        return;
      }
      setCreatedAt(new Date().toLocaleTimeString("zh-TW"));
      router.refresh();
    });
  };

  const reset = () => {
    setParams(DEFAULT_OR_INPUT);
    setCreatedAt(null);
    setError(null);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-md bg-slate-50 border border-slate-200 px-4 py-2.5 text-xs text-slate-600">
        目前期間：<strong className="text-slate-800">{periodLabel}</strong>
      </div>

      <OrInputForm value={params} onChange={setParams} />

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-4">
        {error && <span className="text-xs text-red-600">{error}</span>}
        {createdAt && (
          <span className="inline-flex items-center gap-1 text-xs text-accent-700">
            <Check className="size-3" />
            已建立試算任務 {createdAt}
          </span>
        )}
        <Button variant="outline" size="sm" onClick={reset} disabled={pending}>
          還原預設
        </Button>
        <Button onClick={submit} loading={pending}>
          <Plus className="size-4" />
          建立試算任務
        </Button>
      </div>
    </div>
  );
}

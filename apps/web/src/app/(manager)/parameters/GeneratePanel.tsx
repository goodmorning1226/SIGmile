"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

const ALL = [
  { key: "service_minutes", label: "服務時間" },
  { key: "stop_demand",     label: "站點需求" },
  { key: "eta",             label: "ETA 預估" },
  { key: "workload",        label: "員工負荷" },
  { key: "risk",            label: "風險評估" }
];

interface Props {
  periodId: string;
  existingTypes: string[];
}

export function GeneratePanel({ periodId, existingTypes }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>("");
  const [pending, startTransition] = useTransition();

  const available = ALL.filter((t) => !existingTypes.includes(t.key));

  const run = () => {
    if (!type) return;
    startTransition(async () => {
      const res = await fetch("/api/manager/parameters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planning_period_id: periodId, prediction_type: type })
      });
      const j = await res.json();
      if (!j.ok) {
        alert(j.error?.message ?? "失敗");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  if (available.length === 0) {
    return (
      <Button variant="outline" disabled>
        所有類型皆已產生
      </Button>
    );
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        產生新預測
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-start overflow-y-auto bg-slate-900/40 p-6 backdrop-blur-sm">
          <div className="mx-auto mt-12 w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-card">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-base font-semibold">產生 AI 預測參數</div>
                <p className="mt-1 text-xs text-slate-500">
                  將呼叫 MockAIService 並寫一筆 ai_parameter_predictions
                </p>
              </div>
              <button
                className="text-sm text-slate-400 hover:text-slate-700"
                onClick={() => setOpen(false)}
              >
                關閉
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {available.map((t) => (
                <label
                  key={t.key}
                  className={`flex cursor-pointer items-center justify-between rounded-md border px-3 py-2 ${
                    type === t.key
                      ? "border-brand-300 bg-brand-50"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <span className="text-sm">
                    <span className="font-medium">{t.label}</span>
                    <span className="ml-2 text-xs text-slate-400">{t.key}</span>
                  </span>
                  <input
                    type="radio"
                    name="ptype"
                    checked={type === t.key}
                    onChange={() => setType(t.key)}
                  />
                </label>
              ))}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={run} loading={pending} disabled={!type}>產生</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

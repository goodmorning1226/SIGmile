"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Clock, Box, Gauge, Activity, Shield, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const ALL = [
  { key: "service_minutes", label: "服務時間",   hint: "平均 / P90 分鐘",          icon: Clock },
  { key: "stop_demand",     label: "站點需求",   hint: "平均箱數、尖峰日",         icon: Box },
  { key: "eta",             label: "ETA 預估",   hint: "站與站平均行車時間",       icon: Gauge },
  { key: "workload",        label: "員工負荷",   hint: "每位 driver 目標站數",      icon: Activity },
  { key: "risk",            label: "風險評估",   hint: "高風險區域、延誤機率",      icon: Shield }
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
      setType("");
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
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6 backdrop-blur-sm">
          <div className="mx-auto mt-12 w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-card">
            <div className="flex items-start justify-between border-b border-slate-100 p-5">
              <div>
                <div className="text-base font-semibold">產生 AI 預測參數</div>
                <p className="mt-1 text-xs text-slate-500">
                  選一個類型，系統會以 MockAIService 回傳預設值寫進 ai_parameter_predictions
                </p>
              </div>
              <button
                className="text-slate-400 hover:text-slate-700"
                onClick={() => setOpen(false)}
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="p-5">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {available.map((t) => {
                  const Icon = t.icon;
                  const active = type === t.key;
                  return (
                    <button
                      key={t.key}
                      onClick={() => setType(t.key)}
                      className={
                        "flex items-start gap-3 rounded-lg border p-3 text-left transition " +
                        (active
                          ? "border-brand-500 bg-brand-50 ring-2 ring-brand-200"
                          : "border-slate-200 hover:bg-slate-50")
                      }
                    >
                      <div className={
                        "grid size-9 shrink-0 place-items-center rounded-lg " +
                        (active ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-500")
                      }>
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900">{t.label}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{t.hint}</div>
                        <div className="mt-0.5 text-[10px] font-mono text-slate-400">{t.key}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 p-4">
              <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={run} loading={pending} disabled={!type}>產生</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

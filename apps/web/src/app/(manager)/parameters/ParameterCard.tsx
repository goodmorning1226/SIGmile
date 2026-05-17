"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ParameterForm } from "./forms/ParameterForm";

export interface PredictionRow {
  id: string;
  prediction_type: string;
  output_parameters: Record<string, unknown>;
  confidence_score: number | null;
  model_version: string | null;
  created_at: string;
}

const TYPE_LABEL: Record<string, { label: string; desc: string }> = {
  service_minutes: { label: "服務時間", desc: "每站平均停留時間預估" },
  stop_demand:     { label: "站點需求", desc: "每家門市的貨量與尖峰日" },
  eta:             { label: "ETA 預估", desc: "站與站之間的行車時間" },
  workload:        { label: "員工負荷", desc: "每位物流士的目標工作量" },
  risk:            { label: "風險評估", desc: "高風險區域與延誤機率" }
};

export function ParameterCard({ prediction }: { prediction: PredictionRow }) {
  const router = useRouter();
  const [params, setParams] = useState<Record<string, unknown>>(prediction.output_parameters);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  const meta = TYPE_LABEL[prediction.prediction_type] ?? {
    label: prediction.prediction_type,
    desc: ""
  };

  const dirty = JSON.stringify(params) !== JSON.stringify(prediction.output_parameters);

  const save = () => {
    startTransition(async () => {
      const res = await fetch(`/api/manager/parameters/${prediction.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ output_parameters: params })
      });
      const j = await res.json();
      if (!j.ok) {
        alert(j.error?.message ?? "儲存失敗");
        return;
      }
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>{meta.label}</CardTitle>
            <CardDescription>{meta.desc}</CardDescription>
          </div>
          {prediction.confidence_score !== null && (
            <div className="flex flex-col items-end">
              <Badge tone="info">
                信心度 {(Number(prediction.confidence_score) * 100).toFixed(0)}%
              </Badge>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ParameterForm
          predictionType={prediction.prediction_type}
          value={params}
          onChange={setParams}
        />

        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <div className="text-xs text-slate-400">
            最後更新 {new Date(prediction.created_at).toLocaleString("zh-TW", {
              month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
            })}
          </div>
          <div className="flex items-center gap-2">
            {saved && !dirty && (
              <span className="text-xs text-accent-700">已儲存</span>
            )}
            {dirty && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setParams(prediction.output_parameters);
                  setSaved(false);
                }}
              >
                <RotateCcw className="size-3.5" />
                還原
              </Button>
            )}
            <Button
              size="sm"
              onClick={save}
              loading={pending}
              disabled={!dirty}
            >
              <Save className="size-3.5" />
              儲存
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

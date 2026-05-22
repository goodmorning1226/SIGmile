import { Cpu, Clock, Box } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface AiParamRow {
  id: string;
  prediction_type: string;
  output_parameters: Record<string, unknown>;
  confidence_score: number | null;
  model_version: string | null;
  created_at: string;
}

const TYPE_META: Record<string, { label: string; desc: string; icon: typeof Clock }> = {
  service_minutes: {
    label: "服務時間 σ",
    desc: "AI 預測下季各門市平均停留分鐘 — OR 試算直接吃這個值，主管無需手動調整",
    icon: Clock
  },
  stop_demand: {
    label: "站點需求 q",
    desc: "AI 預測下季各門市平均出貨箱數 — OR 容量約束的輸入",
    icon: Box
  }
};

/**
 * 下季 AI 預測參數（read-only display）。
 * 過去這塊在「發布新路線 / 步驟 2」可被主管手動調整，
 * 現在改為純展示 — 真實的數字應該由 AI 根據前季資料算出，
 * 進 OR 之前不需要人工 override。
 */
export function AiParameterDisplay({ rows }: { rows: AiParamRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Cpu className="size-4 text-brand-500" />
            <CardTitle>下季 AI 預測參數</CardTitle>
          </div>
          <CardDescription>
            尚無 AI 預測。發布新路線時 OR 會自動 fallback 到歷史平均。
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Cpu className="size-4 text-brand-500" />
          <CardTitle>下季 AI 預測參數</CardTitle>
        </div>
        <CardDescription>
          由前季資料推估，OR 試算時自動帶入，主管不需手動調整。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {rows.map((p) => {
            const meta = TYPE_META[p.prediction_type] ?? {
              label: p.prediction_type,
              desc: "",
              icon: Cpu
            };
            const Icon = meta.icon;
            return (
              <div
                key={p.id}
                className="rounded-lg border border-slate-200 bg-slate-50/40 p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-100 text-brand-700">
                      <Icon className="size-4" />
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900">{meta.label}</div>
                      <div className="mt-0.5 text-[10px] font-mono text-slate-400">
                        {p.prediction_type}
                      </div>
                    </div>
                  </div>
                  {p.confidence_score !== null && (
                    <Badge tone="info">
                      信心度 {(Number(p.confidence_score) * 100).toFixed(0)}%
                    </Badge>
                  )}
                </div>

                <p className="mt-2 text-xs text-slate-500">{meta.desc}</p>

                {/* 輸出參數 — 純展示 key/value */}
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  {Object.entries(p.output_parameters).map(([k, v]) => (
                    <div key={k} className="contents">
                      <div className="text-slate-500">{k}</div>
                      <div className="text-right font-mono font-semibold tabular-nums text-slate-800">
                        {typeof v === "number" ? v : JSON.stringify(v)}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 text-[10px] text-slate-400">
                  最後更新 {new Date(p.created_at).toLocaleString("zh-TW", {
                    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
                  })}
                  {p.model_version && <span className="ml-2">· {p.model_version}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

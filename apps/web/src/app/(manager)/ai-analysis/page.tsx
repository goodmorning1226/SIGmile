import { Sparkles, AlertTriangle, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status/StatusBadge";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { RunAnalysisButton } from "./RunAnalysisButton";

export const dynamic = "force-dynamic";

interface RequestRow {
  id: string;
  scope: string;
  status: string;
  model_version: string | null;
  created_at: string;
  completed_at: string | null;
  output_analysis: {
    summary?: string;
    risk_level?: "low" | "medium" | "high";
    delayed_routes?: Array<{
      driver_name: string;
      route_name: string;
      delayed_stops: number;
      estimated_delay_minutes: number;
    }>;
    recommended_actions?: string[];
    generated_at?: string;
  };
}

const RISK_LABEL: Record<"low" | "medium" | "high", { label: string; tone: "success" | "warning" | "danger" }> = {
  low: { label: "低風險", tone: "success" },
  medium: { label: "中風險", tone: "warning" },
  high: { label: "高風險", tone: "danger" }
};

const SCOPE_LABEL: Record<string, string> = {
  today_overview: "今日總覽",
  driver_detail:  "個別物流士",
  period:         "整個規劃期間"
};

export default async function AiAnalysisHistoryPage() {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("ai_analysis_requests")
    .select(
      "id, scope, status, model_version, created_at, completed_at, output_analysis"
    )
    .order("created_at", { ascending: false })
    .limit(30);

  const rows = (data ?? []) as RequestRow[];

  return (
    <>
      <PageHeader
        title="AI 分析"
        description="歷次配送狀況分析紀錄，協助主管掌握風險與建議行動"
        actions={<RunAnalysisButton />}
      />

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-brand-500" />
            <CardTitle>關於 AI 分析</CardTitle>
          </div>
          <CardDescription>
            系統會根據目前的配送進度、準時率與異常件數，自動產出風險等級與建議處理方式。
            按右上方「產生新分析」可以隨時取得最新結果。
          </CardDescription>
        </CardHeader>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">
            尚無任何分析紀錄，可以從右上角觸發第一次分析
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const a = r.output_analysis ?? {};
            const risk = a.risk_level ? RISK_LABEL[a.risk_level] : null;
            return (
              <Card key={r.id}>
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{SCOPE_LABEL[r.scope] ?? "今日總覽"}</Badge>
                    <StatusBadge status={r.status as any} />
                    {risk && <Badge tone={risk.tone}>{risk.label}</Badge>}
                    <span className="ml-auto text-xs text-slate-400">
                      {new Date(r.created_at).toLocaleString("zh-TW", {
                        month: "2-digit", day: "2-digit",
                        hour: "2-digit", minute: "2-digit"
                      })}
                    </span>
                  </div>

                  {a.summary && (
                    <p className="mt-3 text-sm leading-relaxed text-slate-800">
                      {a.summary}
                    </p>
                  )}

                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div>
                      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                        <AlertTriangle className="size-3.5 text-amber-500" />
                        延誤路線
                      </div>
                      {(a.delayed_routes ?? []).length === 0 ? (
                        <p className="text-xs text-slate-500">無</p>
                      ) : (
                        <ul className="space-y-1.5 text-sm">
                          {a.delayed_routes!.map((d, i) => (
                            <li
                              key={i}
                              className="rounded-md border border-slate-200 bg-slate-50/40 px-3 py-2"
                            >
                              <span className="font-medium">{d.driver_name}</span>
                              <span className="text-xs text-slate-500"> · {d.route_name}</span>
                              <span className="ml-2 text-amber-700">
                                延誤 {d.estimated_delay_minutes} 分
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div>
                      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                        <CheckCircle2 className="size-3.5 text-accent-500" />
                        建議處理方式
                      </div>
                      <ul className="space-y-1 text-sm text-slate-700">
                        {(a.recommended_actions ?? []).map((act, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="text-slate-400">·</span>
                            <span>{act}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

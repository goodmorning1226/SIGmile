"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Sparkles, AlertTriangle, Activity, RefreshCcw, Flame, Building2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/* 與 /api/manager/ai-insights 回傳同形 */
interface AIInsight {
  generated_at: string;
  snapshot_date: string;
  risk_level: "low" | "medium" | "high";
  headline: string;
  problem_stops: Array<{
    stop_id: string; stop_name: string; fail_count: number;
    last_fail_reason: string | null; suggestion: string;
  }>;
  delayed_routes: Array<{
    driver_id: string; driver_name: string; route_name: string;
    delayed_stops: number; estimated_delay_minutes: number;
  }>;
  actions: Array<{ priority: "p0" | "p1" | "p2"; text: string; action_hint?: string }>;
}

const RISK_TONE: Record<AIInsight["risk_level"], { tone: "success" | "warning" | "danger"; label: string }> = {
  low:    { tone: "success", label: "低風險" },
  medium: { tone: "warning", label: "中風險" },
  high:   { tone: "danger",  label: "高風險" }
};

const PRIO_LABEL: Record<"p0" | "p1" | "p2", { tone: "danger" | "warning" | "info"; label: string }> = {
  p0: { tone: "danger",  label: "P0 立即處理" },
  p1: { tone: "warning", label: "P1 今日處理" },
  p2: { tone: "info",    label: "P2 持續監控" }
};

/**
 * 今日 AI 深度分析 — 嵌入 Dashboard 用
 *  - 建議行動 (priority p0/p1/p2)
 *  - 今日延誤路線 (>= 15 分)
 *  - 今日延誤 stops (= 重複失敗門市 + 延誤路線統計)
 *
 * 為避免與 Dashboard KPI 卡片重複，這裡刻意不渲染 KPIBlock、outlier、hourly chart。
 */
export function DashboardInsights() {
  const [pending, startTransition] = useTransition();
  const [data, setData] = useState<AIInsight | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/manager/ai-insights", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({})
        });
        const j = await res.json();
        if (!j.ok) {
          setError(j.error?.message ?? "分析失敗");
          return;
        }
        setData(j.data.insight);
      } catch (e) {
        setError(e instanceof Error ? e.message : "未知錯誤");
      }
    });
  };

  useEffect(() => { run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (error) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-red-700">
          <div className="font-semibold">AI 分析失敗</div>
          <div className="mt-1 text-xs">{error}</div>
          <Button onClick={run} className="mt-3" size="sm">重試</Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-slate-500">
          <Sparkles className="mx-auto mb-3 size-8 animate-pulse text-brand-400" />
          {pending ? "AI 正在分析…" : "尚未產生分析"}
          {!pending && (
            <Button onClick={run} className="mt-4" size="sm">開始分析</Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const risk = RISK_TONE[data.risk_level];

  return (
    <div className="space-y-4">
      {/* Headline */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="size-4 text-brand-500" />
            <CardTitle className="text-base">AI 深度分析</CardTitle>
            <Badge tone={risk.tone}>{risk.label}</Badge>
            <span className="text-xs text-slate-400">
              {data.snapshot_date} · 產生於 {new Date(data.generated_at).toLocaleTimeString("zh-TW")}
            </span>
            <Button variant="outline" size="sm" onClick={run} loading={pending} className="ml-auto">
              <RefreshCcw className="size-3.5" />
              重新分析
            </Button>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-slate-800">{data.headline}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 建議行動 (主) */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Activity className="size-4 text-brand-500" />
              <CardTitle>建議行動</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {data.actions.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">目前無 AI 建議行動</p>
            ) : (
              <ul className="space-y-2">
                {data.actions.map((a, i) => {
                  const meta = PRIO_LABEL[a.priority];
                  return (
                    <li
                      key={i}
                      className="flex flex-wrap items-start gap-3 rounded-md border border-slate-200 bg-slate-50/40 p-3"
                    >
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      <div className="flex-1">
                        <div className="text-sm text-slate-800">{a.text}</div>
                        {a.action_hint && (
                          <div className="mt-1 text-xs text-slate-400">{a.action_hint}</div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* 今日延誤路線 */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-500" />
              <CardTitle>今日延誤路線</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {data.delayed_routes.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">無延誤超過 15 分鐘的路線</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {data.delayed_routes.map((d, i) => (
                  <li key={i} className="rounded-md border border-slate-200 bg-slate-50/40 px-3 py-2">
                    <div className="font-medium text-slate-900">{d.driver_name}</div>
                    <div className="text-xs text-slate-500">{d.route_name}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs">
                      <Badge tone="warning">
                        延誤 {d.estimated_delay_minutes} 分
                      </Badge>
                      <span className="text-slate-500">{d.delayed_stops} 站受影響</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 今日延誤 stops（= 失敗 / 重複異常的具體門市） */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="size-4 text-brand-500" />
            <CardTitle>今日延誤 / 異常 stops</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {data.problem_stops.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">今日無 stops 重複異常</p>
          ) : (
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {data.problem_stops.map((s, i) => (
                <li
                  key={i}
                  className="rounded-md border border-slate-200 bg-slate-50/40 p-3 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-900">{s.stop_name}</span>
                    <Badge tone="warning">
                      <Flame className="mr-0.5 inline-block size-3" />
                      {s.fail_count} 次
                    </Badge>
                  </div>
                  {s.last_fail_reason && (
                    <div className="mt-1 text-xs text-slate-500">最近原因：{s.last_fail_reason}</div>
                  )}
                  <div className="mt-1 text-xs text-brand-700">建議：{s.suggestion}</div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

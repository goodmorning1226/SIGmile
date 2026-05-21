"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Sparkles, AlertTriangle, TrendingUp, TrendingDown, CheckCircle2,
  Clock, Users, Building2, Activity, Flame
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface AIInsight {
  generated_at: string;
  snapshot_date: string;
  risk_level: "low" | "medium" | "high";
  headline: string;
  kpi: {
    completion_rate: number;
    on_time_rate: number;
    delayed_stop_count: number;
    total_stops: number;
    in_progress_drivers: number;
    completed_drivers: number;
    delta_vs_average: { completion_pp: number; on_time_pp: number };
  };
  hourly_progress: Array<{ hour: number; completed: number; cumulative_completion_rate: number }>;
  bottleneck_hours: Array<{ hour: number; reason: string; severity: "warn" | "high" }>;
  driver_outliers: Array<{
    driver_id: string; driver_name: string; employee_code: string | null;
    completion_rate: number; on_time_rate: number;
    note: string; kind: "behind" | "ahead" | "high_exception";
  }>;
  problem_stops: Array<{ stop_id: string; stop_name: string; fail_count: number;
    last_fail_reason: string | null; suggestion: string }>;
  delayed_routes: Array<{ driver_id: string; driver_name: string; route_name: string;
    delayed_stops: number; estimated_delay_minutes: number }>;
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

export function InsightsClient() {
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

  useEffect(() => {
    // 自動跑一次
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-red-700">
          <div className="font-semibold">分析失敗</div>
          <div className="mt-1 text-xs">{error}</div>
          <Button onClick={run} className="mt-3">重試</Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-sm text-slate-500">
          <Sparkles className="mx-auto mb-3 size-8 animate-pulse text-brand-400" />
          {pending ? "AI 正在分析…" : "尚未產生分析"}
          {!pending && (
            <Button onClick={run} className="mt-4">開始分析</Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const risk = RISK_TONE[data.risk_level];
  const ds = data.snapshot_date;

  return (
    <div className="space-y-5">
      {/* Headline */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="size-4 text-brand-500" />
            <Badge tone={risk.tone}>{risk.label}</Badge>
            <span className="text-xs text-slate-400">{ds} · 產生於 {new Date(data.generated_at).toLocaleTimeString("zh-TW")}</span>
            <Button variant="outline" size="sm" onClick={run} loading={pending} className="ml-auto">
              重新分析
            </Button>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-slate-800">{data.headline}</p>
        </CardContent>
      </Card>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiBlock
          icon={<CheckCircle2 className="size-4" />}
          label="完成率"
          value={`${(data.kpi.completion_rate * 100).toFixed(1)}%`}
          delta={data.kpi.delta_vs_average.completion_pp}
          deltaLabel="vs 7d 平均"
        />
        <KpiBlock
          icon={<Clock className="size-4" />}
          label="準時率"
          value={`${(data.kpi.on_time_rate * 100).toFixed(1)}%`}
          delta={data.kpi.delta_vs_average.on_time_pp}
          deltaLabel="vs 7d 平均"
        />
        <KpiBlock
          icon={<AlertTriangle className="size-4" />}
          label="延誤 stops"
          value={String(data.kpi.delayed_stop_count)}
          tone={data.kpi.delayed_stop_count > 5 ? "bad" : "neutral"}
          deltaLabel={`/ 總 ${data.kpi.total_stops} 站`}
        />
        <KpiBlock
          icon={<Users className="size-4" />}
          label="進行中物流士"
          value={`${data.kpi.in_progress_drivers}`}
          deltaLabel={`已完成 ${data.kpi.completed_drivers} 位`}
        />
      </div>

      {/* Actions */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-brand-500" />
            <CardTitle>建議行動</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Hourly chart */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-brand-500" />
              <CardTitle>時段累積完成率</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <HourlyChart data={data.hourly_progress} bottlenecks={data.bottleneck_hours} />
            {data.bottleneck_hours.length > 0 && (
              <div className="mt-3 space-y-1">
                {data.bottleneck_hours.map((b, i) => (
                  <div
                    key={i}
                    className={
                      "rounded-md border px-3 py-1.5 text-xs " +
                      (b.severity === "high"
                        ? "border-red-200 bg-red-50 text-red-800"
                        : "border-amber-200 bg-amber-50 text-amber-800")
                    }
                  >
                    <Flame className="mr-1 inline-block size-3" /> {b.reason}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Driver outliers */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="size-4 text-brand-500" />
              <CardTitle>物流士 outlier</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {data.driver_outliers.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-500">所有人皆在平均一個標準差內</div>
            ) : (
              <ul className="space-y-2">
                {data.driver_outliers.map((d, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-2 text-sm"
                  >
                    {d.kind === "ahead" ? (
                      <TrendingUp className="mt-0.5 size-4 shrink-0 text-accent-500" />
                    ) : d.kind === "behind" ? (
                      <TrendingDown className="mt-0.5 size-4 shrink-0 text-amber-500" />
                    ) : (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">
                        {d.driver_name}
                        {d.employee_code && (
                          <span className="ml-1 text-xs font-normal text-slate-400">({d.employee_code})</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500">{d.note}</div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        完成 {(d.completion_rate * 100).toFixed(0)}% · 準時 {(d.on_time_rate * 100).toFixed(0)}%
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Problem stops */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 className="size-4 text-brand-500" />
              <CardTitle>門市異常熱點 (7 天)</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {data.problem_stops.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-500">無重複異常的門市</div>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.problem_stops.map((s, i) => (
                  <li key={i} className="rounded-md border border-slate-200 bg-slate-50/40 p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{s.stop_name}</span>
                      <Badge tone="warning">{s.fail_count} 次</Badge>
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

        {/* Delayed routes */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-brand-500" />
              <CardTitle>今日延誤路線</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {data.delayed_routes.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-500">無延誤超過 15 分鐘的路線</div>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {data.delayed_routes.map((d, i) => (
                  <li key={i} className="rounded-md border border-slate-200 bg-slate-50/40 px-3 py-2">
                    <span className="font-medium">{d.driver_name}</span>
                    <span className="ml-1 text-xs text-slate-500">· {d.route_name}</span>
                    <span className="ml-2 text-amber-700">
                      延誤 {d.estimated_delay_minutes} 分 ({d.delayed_stops} 站)
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiBlock({
  icon, label, value, delta, deltaLabel, tone
}: { icon: React.ReactNode; label: string; value: string; delta?: number; deltaLabel: string; tone?: "bad" | "neutral" }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-xs text-slate-500">{icon}{label}</div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "bad" ? "text-red-600" : "text-slate-900"}`}>
          {value}
        </div>
        <div className="mt-1 text-xs">
          {delta !== undefined ? (
            <span className={
              delta > 0 ? "text-accent-600 font-medium"
                : delta < 0 ? "text-red-600 font-medium"
                  : "text-slate-400"
            }>
              {delta > 0 ? "+" : ""}{(delta * 100).toFixed(1)} pp
            </span>
          ) : null}
          <span className="ml-1 text-slate-400">{deltaLabel}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function HourlyChart({
  data, bottlenecks
}: { data: AIInsight["hourly_progress"]; bottlenecks: AIInsight["bottleneck_hours"] }) {
  if (data.length === 0) return <div className="py-6 text-center text-sm text-slate-500">無資料</div>;
  const W = 560, H = 180, padL = 36, padR = 12, padT = 12, padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const xAt = (i: number) => padL + (i / (data.length - 1)) * innerW;
  const yAt = (rate: number) => padT + (1 - rate) * innerH;

  const path = data.map((d, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(d.cumulative_completion_rate)}`).join(" ");
  // expected linear from 8AM (i where hour=8) to 18:00 (i where hour=18)
  const expPath = (() => {
    const seg: string[] = [];
    for (let i = 0; i < data.length; i++) {
      const h = data[i].hour;
      const expected = Math.max(0, Math.min(1, (h - 8) / 10));
      seg.push(`${i === 0 ? "M" : "L"}${xAt(i)},${yAt(expected)}`);
    }
    return seg.join(" ");
  })();
  const bottleneckSet = new Set(bottlenecks.map((b) => b.hour));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ aspectRatio: `${W}/${H}` }}>
      {/* y grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((r, i) => (
        <g key={i}>
          <line x1={padL} y1={yAt(r)} x2={W - padR} y2={yAt(r)} stroke="#f1f5f9" strokeWidth={1} />
          <text x={padL - 4} y={yAt(r) + 3} fontSize={9} textAnchor="end" fill="#94a3b8">
            {(r * 100).toFixed(0)}%
          </text>
        </g>
      ))}
      {/* x labels */}
      {data.map((d, i) => (
        <text key={i} x={xAt(i)} y={H - 8} fontSize={9} textAnchor="middle" fill="#94a3b8">
          {d.hour}:00
        </text>
      ))}
      {/* expected line */}
      <path d={expPath} fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 4" />
      {/* actual */}
      <path d={path} fill="none" stroke="#f59e0b" strokeWidth={2.5} />
      {/* bottleneck dots */}
      {data.map((d, i) => {
        if (!bottleneckSet.has(d.hour)) return null;
        return (
          <g key={`bn-${i}`}>
            <circle cx={xAt(i)} cy={yAt(d.cumulative_completion_rate)} r={5} fill="#ef4444" />
          </g>
        );
      })}
      <g transform={`translate(${W - 130}, ${padT + 6})`}>
        <rect width={6} height={2} y={4} fill="#f59e0b" />
        <text x={10} y={8} fontSize={9} fill="#64748b">實際</text>
        <rect width={6} height={2} y={16} fill="#94a3b8" />
        <text x={10} y={20} fontSize={9} fill="#64748b">預期 (8 → 18 線性)</text>
      </g>
    </svg>
  );
}

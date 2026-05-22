import { CalendarDays, TrendingUp, AlertTriangle, Store, Flame, PieChart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StopStatusDonut } from "@/components/charts/StopStatusDonut";
import type { QuarterlyAnalysis, QuarterlyKpi } from "@/lib/services/quarterly-analysis-service";

/**
 * 季度分析 — 嵌入 Dashboard 用（取代原本 /quarterly-analysis 獨立頁）
 *  - 跨季 KPI 比較
 *  - 季內月度趨勢
 *  - 季度摘要表
 *  - 門市異常熱點（季為期）
 *  - 已移除「物流士排行」
 */
export function QuarterlySection({
  data, quarter
}: { data: QuarterlyAnalysis; quarter: string }) {
  const { current, previous, monthly_trend, problem_stores, status_breakdown } = data;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const delta = (cur: number, prev?: number | null) =>
    prev == null || prev === 0
      ? null
      : Number((((cur - prev) / prev) * 100).toFixed(1));

  return (
    <div className="space-y-4">
      {/* 季 KPI 比較 */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCompareCard
          icon={<TrendingUp className="size-4" />}
          label="完成率"
          value={pct(current.completion_rate)}
          deltaPct={delta(current.completion_rate, previous?.completion_rate)}
          hint={`${current.completed_stops} / ${current.total_stops} 站`}
        />
        <KpiCompareCard
          icon={<TrendingUp className="size-4" />}
          label="準時率"
          value={pct(current.on_time_rate)}
          deltaPct={delta(current.on_time_rate, previous?.on_time_rate)}
          hint={`${current.on_time_stops} / ${current.completed_stops} 已完成站`}
        />
        <KpiCompareCard
          icon={<AlertTriangle className="size-4" />}
          label="異常事件"
          value={String(current.exception_stops)}
          deltaPct={delta(current.exception_stops, previous?.exception_stops)}
          inverse
          hint="失敗 / 客訴 / 無法配送"
        />
        <KpiCompareCard
          icon={<Store className="size-4" />}
          label="服務門市數"
          value={String(current.unique_stores)}
          deltaPct={delta(current.unique_stores, previous?.unique_stores)}
          hint={`${current.unique_drivers} 位物流士`}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 月度趨勢 */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4 text-brand-500" />
              <CardTitle>月度趨勢</CardTitle>
            </div>
            <CardDescription>
              {current.start_date} ~ {current.end_date}（{quarter}）
              {previous && ` · 上季 ${previous.quarter}：${previous.completed_stops} 站完成`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MonthlyTrendChart points={monthly_trend} />
          </CardContent>
        </Card>

        {/* 季度摘要 */}
        <Card>
          <CardHeader>
            <CardTitle>季度摘要</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <QuarterRow label="本季" v={current} />
            {previous && <QuarterRow label="上季" v={previous} />}
          </CardContent>
        </Card>
      </section>

      {/* 站點狀態分佈（季）— 從今日總覽搬過來的視覺化 */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <PieChart className="size-4 text-brand-500" />
            <CardTitle>站點狀態分佈（本季）</CardTitle>
          </div>
          <CardDescription>
            本季所有站點的最終狀態加總
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StopStatusDonut data={status_breakdown} />
        </CardContent>
      </Card>

      {/* 門市異常熱點 — 季為期 */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Flame className="size-4 text-amber-500" />
            <CardTitle>門市異常熱點（本季）</CardTitle>
          </div>
          <CardDescription>
            本季有延誤或異常記錄的門市（依異常 + 延誤次數總和排序）
          </CardDescription>
        </CardHeader>
        <CardContent>
          {problem_stores.length === 0 ? (
            <p className="text-sm text-accent-700">本季沒有任何延誤 / 異常 — 表現極佳 ✨</p>
          ) : (
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {problem_stores.map((s) => (
                <li
                  key={s.stop_id}
                  className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50/40 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-900">{s.stop_name}</div>
                    <div className="text-xs text-slate-500">
                      {s.city ?? ""} {s.district ?? ""}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    {s.late_count > 0 && (
                      <Badge tone="warning">延誤 {s.late_count}</Badge>
                    )}
                    {s.exception_count > 0 && (
                      <Badge tone="danger">異常 {s.exception_count}</Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCompareCard({
  icon, label, value, deltaPct, inverse, hint
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  deltaPct: number | null;
  inverse?: boolean;
  hint?: string;
}) {
  const positiveTrend =
    deltaPct == null ? null : (inverse ? deltaPct < 0 : deltaPct > 0);
  const tone =
    positiveTrend == null ? "neutral" :
    positiveTrend ? "success" : "danger";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          {icon}{label}
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
          {value}
        </div>
        <div className="mt-1 flex items-baseline gap-2 text-xs">
          {deltaPct != null && (
            <Badge tone={tone}>
              {deltaPct > 0 ? "▲" : deltaPct < 0 ? "▼" : ""}
              {Math.abs(deltaPct).toFixed(1)}%
            </Badge>
          )}
          {hint && <span className="text-slate-500">{hint}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function QuarterRow({ label, v }: { label: string; v: QuarterlyKpi }) {
  return (
    <div>
      <div className="text-xs font-semibold text-slate-500">{label}（{v.quarter}）</div>
      <div className="mt-1 grid grid-cols-2 gap-y-1 text-xs">
        <div className="text-slate-500">任務數</div>
        <div className="text-right font-medium tabular-nums">{v.total_tasks}</div>
        <div className="text-slate-500">總站數</div>
        <div className="text-right font-medium tabular-nums">{v.total_stops}</div>
        <div className="text-slate-500">完成率</div>
        <div className="text-right font-medium tabular-nums">{(v.completion_rate * 100).toFixed(1)}%</div>
        <div className="text-slate-500">準時率</div>
        <div className="text-right font-medium tabular-nums">{(v.on_time_rate * 100).toFixed(1)}%</div>
        <div className="text-slate-500">物流士數</div>
        <div className="text-right font-medium tabular-nums">{v.unique_drivers}</div>
      </div>
    </div>
  );
}

function MonthlyTrendChart({ points }: { points: { ym: string; completed: number; on_time: number; exceptions: number }[] }) {
  if (points.length === 0) {
    return <p className="text-sm text-slate-500">本季尚無任何配送資料</p>;
  }
  const maxBar = Math.max(...points.map((p) => p.completed));
  return (
    <div className="space-y-2">
      {points.map((p) => (
        <div key={p.ym} className="flex items-center gap-3">
          <div className="w-16 shrink-0 font-mono text-xs text-slate-500">{p.ym}</div>
          <div className="flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-6 bg-brand-500 transition-all"
              style={{ width: maxBar === 0 ? "0%" : `${(p.completed / maxBar) * 100}%` }}
            />
          </div>
          <div className="w-24 shrink-0 text-right text-xs">
            <span className="font-semibold tabular-nums text-slate-900">{p.completed}</span>
            <span className="text-slate-400"> / 準時 {p.on_time}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

import { TrendingUp, AlertTriangle, Store, Flame, Truck, MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OnTimeBucketDonut } from "@/components/charts/OnTimeBucketDonut";
import type { QuarterlyAnalysis, QuarterlyKpi } from "@/lib/services/quarterly-analysis-service";

/**
 * 季度分析區塊：
 *  1. 跨季 KPI 比較（4 張卡）
 *  2. 季度摘要（左：上季、右：本季）滿版
 *  3. 門市異常熱點（本季）
 *
 * 已移除：月度趨勢、站點狀態分佈、物流士排行。
 */
export function QuarterlySection({
  data, quarter
}: { data: QuarterlyAnalysis; quarter: string }) {
  const { current, previous, problem_stores, driver_on_time_buckets, store_on_time_buckets } = data;
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

      {/* 季度摘要 — 滿版，左：上季 / 右：本季 */}
      <Card>
        <CardHeader>
          <CardTitle>季度摘要</CardTitle>
          <CardDescription>
            {current.start_date} ~ {current.end_date}（{quarter}）
            {previous && ` · 與上季 ${previous.quarter} 比較`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <QuarterColumn label="上季" v={previous} align="left" />
            <QuarterColumn label="本季" v={current}  align="right" />
          </div>
        </CardContent>
      </Card>

      {/* 準時率分佈 — 左：物流士、右：門市 */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Truck className="size-4 text-brand-500" />
              <CardTitle>物流士準時率</CardTitle>
            </div>
            <CardDescription>
              本季每位物流士的準時率落在哪個 20% 區間（紅 → 綠 = 差 → 好）
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OnTimeBucketDonut data={driver_on_time_buckets} centerLabel="位物流士" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <MapPin className="size-4 text-brand-500" />
              <CardTitle>門市到貨準時率</CardTitle>
            </div>
            <CardDescription>
              本季每家門市的到貨準時率分佈，反映哪些門市常被延誤
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OnTimeBucketDonut data={store_on_time_buckets} centerLabel="家門市" />
          </CardContent>
        </Card>
      </section>

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

function QuarterColumn({
  label, v, align
}: {
  label: string;
  v: QuarterlyKpi | null;
  align: "left" | "right";
}) {
  const border =
    align === "left"
      ? "md:border-r md:border-slate-100 md:pr-6"
      : "md:pl-6";
  if (!v) {
    return (
      <div className={border}>
        <div className="mb-3 text-sm font-semibold text-slate-700">{label}</div>
        <div className="rounded-md border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
          無資料
        </div>
      </div>
    );
  }
  return (
    <div className={border}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-slate-700">{label}</span>
        <span className="text-xs font-mono text-slate-400">{v.quarter}</span>
      </div>
      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        <dt className="text-slate-500">任務數</dt>
        <dd className="text-right font-medium tabular-nums text-slate-900">{v.total_tasks}</dd>

        <dt className="text-slate-500">派送次數</dt>
        <dd className="text-right font-medium tabular-nums text-slate-900">{v.total_stops}</dd>

        <dt className="text-slate-500">服務門市數</dt>
        <dd className="text-right font-medium tabular-nums text-slate-900">{v.unique_stores}</dd>

        <dt className="text-slate-500">完成率</dt>
        <dd className="text-right font-medium tabular-nums text-slate-900">
          {(v.completion_rate * 100).toFixed(1)}%
        </dd>

        <dt className="text-slate-500">準時率</dt>
        <dd className="text-right font-medium tabular-nums text-slate-900">
          {(v.on_time_rate * 100).toFixed(1)}%
        </dd>

        <dt className="text-slate-500">物流士數</dt>
        <dd className="text-right font-medium tabular-nums text-slate-900">{v.unique_drivers}</dd>
      </dl>
    </div>
  );
}

import {
  AlertTriangle, CheckCircle2, Clock, MapPin,
  PieChart, TrendingUp, Truck, UploadCloud
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard, type KpiCardProps } from "@/components/kpi/KpiCard";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CumulativeRateChart } from "@/components/charts/CumulativeRateChart";
import { StopStatusDonut } from "@/components/charts/StopStatusDonut";
import { getDashboardBundle } from "@/lib/services/dashboard-service";
import { AiAnalysisButton } from "./AiAnalysisButton";
import { DashboardInsights } from "./DashboardInsights";

export const dynamic = "force-dynamic";

type Tone = NonNullable<KpiCardProps["tone"]>;

function toneByRate(value: number, good: number, warn: number): Tone {
  if (value >= good) return "good";
  if (value >= warn) return "warn";
  return "bad";
}
function toneByCount(count: number, warnAtOrAbove: number, badAtOrAbove: number): Tone {
  if (count >= badAtOrAbove) return "bad";
  if (count >= warnAtOrAbove) return "warn";
  return "good";
}

export default async function DashboardPage() {
  const { kpi, charts } = await getDashboardBundle();

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const completionTone = toneByRate(kpi.completion_rate, 0.8, 0.5);
  const onTimeTone     = toneByRate(kpi.on_time_rate, 0.85, 0.6);
  const exceptionTone  = toneByCount(kpi.exception_count, 1, 3);

  return (
    <>
      <PageHeader
        title="今日總覽"
        description={`${kpi.snapshot_date} · 今日派送 ${kpi.total_stop_count} 站 · 即時配送狀態與門市指標`}
        actions={
          <AiAnalysisButton context={{
            completion_rate: kpi.completion_rate,
            on_time_rate: kpi.on_time_rate,
            exception_count: kpi.exception_count
          }} />
        }
      />

      {/* 今日主要指標 */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="完成率"
          value={pct(kpi.completion_rate)}
          tone={completionTone}
          hint={`${kpi.total_stop_count} 站總數`}
          icon={<CheckCircle2 className="size-4" />}
        />
        <KpiCard
          label="配送到店率"
          value={pct(kpi.store_arrival_rate)}
          hint="已抵達門市的比例"
          icon={<MapPin className="size-4" />}
        />
        <KpiCard
          label="門市準時率"
          value={pct(kpi.on_time_rate)}
          tone={onTimeTone}
          hint="準時 ÷ 已到店"
          icon={<Clock className="size-4" />}
        />
      </section>

      {/* 計數指標 */}
      <section className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="已上傳門市"
          value={kpi.uploaded_store_count}
          icon={<UploadCloud className="size-4" />}
        />
        <KpiCard
          label="已到店門市"
          value={kpi.arrived_store_count}
          icon={<MapPin className="size-4" />}
        />
        <KpiCard
          label="準時門市"
          value={kpi.on_time_store_count}
          icon={<Clock className="size-4" />}
        />
        <KpiCard
          label="進行中物流士"
          value={kpi.in_progress_driver_count}
          icon={<Truck className="size-4" />}
        />
      </section>

      {/* === 圖表分析 === */}
      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-brand-500" />
              <CardTitle>時段累積完成率</CardTitle>
            </div>
            <CardDescription>
              今日累計完成率 vs 預期線 (08:00 → 18:00 線性)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CumulativeRateChart
              data={charts.hourly}
              totalStops={kpi.total_stop_count}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <PieChart className="size-4 text-brand-500" />
              <CardTitle>站點狀態分佈</CardTitle>
            </div>
            <CardDescription>今日所有停靠站的目前狀態</CardDescription>
          </CardHeader>
          <CardContent>
            <StopStatusDonut data={charts.status} />
          </CardContent>
        </Card>
      </section>

      {/* === 今日 AI 深度分析 + 延誤 panel === */}
      <section className="mt-6">
        <DashboardInsights />
      </section>

      {/* 今日異常摘要 */}
      <section className="mt-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className={`size-4 ${exceptionTone === "bad" ? "text-red-500" : exceptionTone === "warn" ? "text-amber-500" : "text-accent-500"}`} />
              <CardTitle>今日異常總數</CardTitle>
            </div>
            <CardDescription>失敗 / 無法配送 / 客訴 — 點上方 AI 分析按鈕可由系統建議處理方案</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums text-slate-900">
              {kpi.exception_count}
              <span className="ml-1 text-sm font-normal text-slate-500">件</span>
            </div>
          </CardContent>
        </Card>
      </section>
    </>
  );
}

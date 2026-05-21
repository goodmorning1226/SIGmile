import {
  Activity, AlertTriangle, BarChart3, CheckCircle2, Clock, MapPin,
  PieChart, TrendingUp, Truck, UploadCloud
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { KpiCard, type KpiCardProps } from "@/components/kpi/KpiCard";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { HourlyProgressChart } from "@/components/charts/HourlyProgressChart";
import { DriverRankingChart } from "@/components/charts/DriverRankingChart";
import { StopStatusDonut } from "@/components/charts/StopStatusDonut";
import { getDashboardBundle } from "@/lib/services/dashboard-service";
import { AiAnalysisButton } from "./AiAnalysisButton";

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
  // 一次 round-trip 抓 tasks+stops，同時算 KPI 和圖表
  // （之前 metricsService + getDashboardCharts 各打一次同樣的 query）
  const { kpi, charts } = await getDashboardBundle();

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const completionTone = toneByRate(kpi.completion_rate, 0.8, 0.5);
  const onTimeTone     = toneByRate(kpi.on_time_rate, 0.85, 0.6);
  const exceptionTone  = toneByCount(kpi.exception_count, 1, 3);

  return (
    <>
      <PageHeader
        title="今日總覽"
        description={`${kpi.snapshot_date} · 即時掌握所有物流士的配送狀態與門市指標`}
        actions={
          <AiAnalysisButton context={{
            completion_rate: kpi.completion_rate,
            on_time_rate: kpi.on_time_rate,
            exception_count: kpi.exception_count
          }} />
        }
      />

      {/* 主要指標 */}
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
        {/* 每小時完成進度（占 2 格） */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-brand-500" />
              <CardTitle>每小時完成進度</CardTitle>
            </div>
            <CardDescription>累計完成站數隨時間變化 · 06:00 – 22:00</CardDescription>
          </CardHeader>
          <CardContent>
            <HourlyProgressChart
              data={charts.hourly}
              totalStops={kpi.total_stop_count}
            />
          </CardContent>
        </Card>

        {/* 站點狀態分佈 donut */}
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

      {/* 物流士進度排行 + 今日異常 + 快速操作 */}
      <section className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className="size-4 text-brand-500" />
                <CardTitle>物流士進度排行</CardTitle>
              </div>
              <a
                href="/drivers"
                className="text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                查看全部 →
              </a>
            </div>
            <CardDescription>依完成率排序，落後者會凸顯</CardDescription>
          </CardHeader>
          <CardContent>
            <DriverRankingChart data={charts.drivers} limit={8} />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertTriangle className={`size-4 ${exceptionTone === "bad" ? "text-red-500" : exceptionTone === "warn" ? "text-amber-500" : "text-accent-500"}`} />
                <CardTitle>今日異常</CardTitle>
              </div>
              <CardDescription>失敗 / 無法配送 / 客訴等</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold tabular-nums text-slate-900">
                {kpi.exception_count}
                <span className="ml-1 text-sm font-normal text-slate-500">件</span>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                點上方 AI 分析按鈕可由系統自動建議處理方案
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Activity className="size-4 text-brand-500" />
                <CardTitle>快速操作</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <QuickAction href="/drivers" label="查看物流士進度" hint="所有人員狀態與目前站" />
              <QuickAction href="/route-planning" label="路線歷史" hint="檢視過去路線版本" />
              <QuickAction href="/or-replanning" label="發布新路線" hint="試算並採用新路線" />
            </CardContent>
          </Card>
        </div>
      </section>
    </>
  );
}

function QuickAction({ href, label, hint }: { href: string; label: string; hint: string }) {
  return (
    <a
      href={href}
      className="group flex flex-col rounded-lg border border-slate-200 bg-slate-50/50 p-3 transition hover:border-brand-300 hover:bg-brand-50/50"
    >
      <div className="text-sm font-semibold text-slate-900 group-hover:text-brand-700">{label}</div>
      <div className="mt-0.5 text-xs text-slate-500">{hint}</div>
    </a>
  );
}

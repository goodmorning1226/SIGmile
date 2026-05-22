import { Sliders, RefreshCw, Database } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { OrJobList } from "./OrJobList";
import { StopsExcelPanel } from "./StopsExcelPanel";
import { Step2Parameters } from "./Step2Parameters";

export const dynamic = "force-dynamic";

interface PeriodRow {
  id: string;
  code: string;
  name: string;
  status: string;
}

interface JobRow {
  id: string;
  planning_period_id: string;
  status: string;
  engine_version: string | null;
  input_parameters: Record<string, unknown>;
  output_plan: Record<string, unknown>;
  created_route_plan_id: string | null;
  created_at: string;
  completed_at: string | null;
}

export default async function PublishRoutePage() {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  // ★ 三個獨立 query 一次發出，省 ~2 round-trips
  const [periodsRes, jobsRes, stopCountRes] = await Promise.all([
    supabase
      .from("planning_periods")
      .select("id, code, name, status")
      .order("start_date", { ascending: false })
      .returns<PeriodRow[]>(),
    supabase
      .from("or_planning_jobs")
      .select(
        "id, planning_period_id, status, engine_version, input_parameters, " +
          "output_plan, created_route_plan_id, created_at, completed_at"
      )
      .order("created_at", { ascending: false })
      .limit(20)
      .returns<JobRow[]>(),
    admin
      .from("stops")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
  ]);

  const periods = periodsRes.data;
  const jobs = jobsRes.data;
  const stopCount = stopCountRes.count;

  const activePeriod =
    (periods ?? []).find((p) => p.status === "active") ?? (periods ?? [])[0];

  const periodJobs = activePeriod
    ? (jobs ?? []).filter((j) => j.planning_period_id === activePeriod.id)
    : [];

  return (
    <>
      <PageHeader
        title="發布新路線"
        description="設定規劃參數 --> 試算最佳路線 --> 預覽結果 --> 採用為草稿 / 直接發布"
      />

      {!activePeriod && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-500">
            尚未建立任何規劃期間（planning period），請先聯絡管理員。
          </CardContent>
        </Card>
      )}

      {activePeriod && (
        <div className="space-y-6">
          {/* 步驟 1：停靠點資料 */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Database className="size-4 text-brand-500" />
                <CardTitle>步驟 1 · 停靠點資料</CardTitle>
              </div>
              <CardDescription>
                試算所需的所有停靠點資料。請確認資料為最新狀態。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StopsExcelPanel totalStops={stopCount ?? 0} />
            </CardContent>
          </Card>

          {/* 步驟 2：規劃參數（OR 求解器設定 — 試算前可調整） */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sliders className="size-4 text-brand-500" />
                <CardTitle>步驟 2 · 規劃參數</CardTitle>
              </div>
              <CardDescription>
                設定 OR 求解器的工時上限、加班門檻與五個目標函數權重，調整後按「建立試算任務」即可送出。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Step2Parameters
                periodId={activePeriod.id}
                periodLabel={`${activePeriod.code} · ${activePeriod.name}`}
              />
            </CardContent>
          </Card>

          {/* 步驟 3：試算任務 */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <RefreshCw className="size-4 text-brand-500" />
                <CardTitle>步驟 3 · 試算與結果預覽</CardTitle>
              </div>
              <CardDescription>
                每筆任務代表一次試算，可同時建立多筆任務以比較不同條件。
                採用後會建立「草稿」，可至「路線集」/「物流士分配」繼續微調。
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <OrJobList jobs={periodJobs} />
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

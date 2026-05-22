import { Sliders, RefreshCw, Database } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { OrJobList } from "./OrJobList";
import { CreateJobPanel } from "./CreateJobPanel";
import { StopsExcelPanel } from "./StopsExcelPanel";
import { ParameterCard, type PredictionRow } from "../parameters/ParameterCard";
import { GeneratePanel } from "../parameters/GeneratePanel";

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

  // 取得當前 period 的規劃參數（要等 activePeriod 才能下，但只有這一個）
  const { data: paramsRows } = activePeriod
    ? await admin
        .from("ai_parameter_predictions")
        .select("id, prediction_type, output_parameters, confidence_score, model_version, created_at")
        .eq("planning_period_id", activePeriod.id)
        .order("prediction_type", { ascending: true })
    : { data: [] };

  // 只顯示 OR 真的會吃的兩種 (σ / q)；舊資料如 eta/workload/risk 直接過濾掉
  const OR_USED = new Set(["service_minutes", "stop_demand"]);
  const predictions = ((paramsRows ?? []) as PredictionRow[])
    .filter((p) => OR_USED.has(p.prediction_type));

  return (
    <>
      <PageHeader
        title="發布新路線"
        description="設定規劃參數 --> 試算最佳路線 --> 預覽結果 --> 採用為草稿 / 直接發布"
        actions={
          activePeriod ? (
            <CreateJobPanel
              periodId={activePeriod.id}
              periodLabel={`${activePeriod.code} · ${activePeriod.name}`}
            />
          ) : null
        }
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

          {/* 步驟 2：規劃參數 */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sliders className="size-4 text-brand-500" />
                  <CardTitle>步驟 2 · 規劃參數</CardTitle>
                </div>
                <GeneratePanel
                  periodId={activePeriod.id}
                  existingTypes={predictions.map((p) => p.prediction_type)}
                />
              </div>
              <CardDescription>
                可手動調整各類預測參數。預設數字為過去資料統計結果。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {predictions.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  尚無參數，按右上方「產生新預測」開始。
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  {predictions.map((p) => (
                    <ParameterCard key={p.id} prediction={p} />
                  ))}
                </div>
              )}
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

import { Sliders, RefreshCw, Database, Info } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { OrJobList } from "./OrJobList";
import { CreateJobPanel } from "./CreateJobPanel";
import { StopsExcelPanel } from "./StopsExcelPanel";
import { PythonHookPanel } from "./PythonHookPanel";
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

  const predictions = (paramsRows ?? []) as PredictionRow[];

  return (
    <>
      <PageHeader
        title="發布新路線"
        description="設定規劃參數、試算最佳路線、預覽結果並決定採用為草稿或直接發布"
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
          {/* 流程說明 */}
          <Card>
            <CardContent className="flex items-start gap-3 p-5">
              <div className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700">
                <Info className="size-4" />
              </div>
              <div className="text-sm text-slate-700">
                <div className="font-semibold text-slate-900">建議流程</div>
                <ol className="mt-1.5 space-y-0.5 list-decimal pl-5 text-slate-600">
                  <li>「停靠點資料」確認是最新的（可用 Excel 匯入匯出）</li>
                  <li>「規劃參數」微調權重與限制</li>
                  <li>右上「建立新規劃任務」→ 在卡片裡按「Mock 試算」或「Gurobi 試算」</li>
                  <li>
                    試算完成 → 到{" "}
                    <Link href="/clusters" className="text-brand-600 hover:underline">
                      路線集
                    </Link>{" "}
                    /{" "}
                    <Link href="/assignment" className="text-brand-600 hover:underline">
                      物流士分配
                    </Link>{" "}
                    微調 → 或直接按「採用此結果」存草稿、「採用並發布」立即發布
                  </li>
                </ol>
                <div className="mt-2 text-xs text-slate-500">
                  目前期間：{activePeriod.code} · {activePeriod.name}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 步驟 0：停靠點資料 */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Database className="size-4 text-brand-500" />
                <CardTitle>步驟 0 · 停靠點資料</CardTitle>
              </div>
              <CardDescription>
                試算所需的所有停靠點資料。可下載 Excel 修改門市清單 / 時窗 / 貨量等後上傳灌回。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StopsExcelPanel totalStops={stopCount ?? 0} />
            </CardContent>
          </Card>

          {/* 步驟 1：規劃參數 */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sliders className="size-4 text-brand-500" />
                  <CardTitle>步驟 1 · 規劃參數</CardTitle>
                </div>
                <GeneratePanel
                  periodId={activePeriod.id}
                  existingTypes={predictions.map((p) => p.prediction_type)}
                />
              </div>
              <CardDescription>
                各類預測參數（服務時間、員工負荷、風險區域等）。
                試算時會被使用，可手動調整。
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

          {/* 步驟 2：試算任務 */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <RefreshCw className="size-4 text-brand-500" />
                <CardTitle>步驟 2 · 試算與結果預覽</CardTitle>
              </div>
              <CardDescription>
                每筆任務代表一次試算。可以建立多筆比較不同條件，再選一個結果採用。
                採用後會建立新版「草稿」，到「路線集」/「物流士分配」可繼續微調。
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <OrJobList jobs={periodJobs} />
            </CardContent>
          </Card>

          {/* Python 接點說明 */}
          <PythonHookPanel />
        </div>
      )}
    </>
  );
}

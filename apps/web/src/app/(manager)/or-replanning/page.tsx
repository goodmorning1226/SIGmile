import { Sliders, RefreshCw, Info } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { OrJobList } from "./OrJobList";
import { CreateJobPanel } from "./CreateJobPanel";
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

  const { data: periods } = await supabase
    .from("planning_periods")
    .select("id, code, name, status")
    .order("start_date", { ascending: false })
    .returns<PeriodRow[]>();

  const activePeriod =
    (periods ?? []).find((p) => p.status === "active") ?? (periods ?? [])[0];

  const { data: jobs } = await supabase
    .from("or_planning_jobs")
    .select(
      "id, planning_period_id, status, engine_version, input_parameters, " +
        "output_plan, created_route_plan_id, created_at, completed_at"
    )
    .order("created_at", { ascending: false })
    .limit(20)
    .returns<JobRow[]>();

  // 只列當前 period 的試算任務
  const periodJobs = activePeriod
    ? (jobs ?? []).filter((j) => j.planning_period_id === activePeriod.id)
    : [];

  // 取得當前 period 的規劃參數
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
        description="設定規劃參數、試算最佳路線、一鍵採用並發布給物流士"
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
                  <li>確認下方「規劃參數」是否合理，可微調</li>
                  <li>右上「建立新試算任務」→ 系統會用最新參數產生試算結果</li>
                  <li>展開試算結果檢視，按「採用此結果」即建立新草稿；按「採用並發布」會立即發布給物流士</li>
                </ol>
                <div className="mt-2 text-xs text-slate-500">
                  目前期間：{activePeriod.code} · {activePeriod.name}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 規劃參數 section */}
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
                這些參數會被「試算」用來決定每位物流士的目標站數、各門市平均停留時間等。
                數值由系統自動預測，可手動調整以符合實際運作。
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

          {/* 試算 section */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <RefreshCw className="size-4 text-brand-500" />
                <CardTitle>步驟 2 · 試算路線</CardTitle>
              </div>
              <CardDescription>
                每筆任務代表一次試算。可以建立多筆比較不同條件，再選一個結果採用。
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

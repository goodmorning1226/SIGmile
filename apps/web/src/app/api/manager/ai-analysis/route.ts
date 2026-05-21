import { requireManager } from "@/lib/auth/server-auth";
import { ok, fail, handleApiError } from "@/lib/api/response";
import { aiService } from "@/lib/services/ai-service";
import { getDashboardBundle } from "@/lib/services/dashboard-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/manager/ai-analysis
 * body: { scope: 'today_overview' | 'driver_detail' | 'period', scope_ref_id?, context? }
 *
 * 流程：
 *   1. server 端讀目前真實 KPI + 真實延誤路線（避免吃前端傳來可能過期的 snapshot）
 *   2. 寫 ai_analysis_requests (status=pending, input_snapshot)
 *   3. 呼叫 aiService.analyzeDeliveryStatus(mock)
 *   4. 更新 ai_analysis_requests → completed
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireManager();
    const body = await request.json().catch(() => ({}));
    const scope = body?.scope as "today_overview" | "driver_detail" | "period" | undefined;
    if (!scope) return fail("BAD_REQUEST", "scope 為必填", 400);

    const admin = createSupabaseAdminClient();

    // 真實 KPI snapshot
    const { kpi } = await getDashboardBundle();

    // 真實延誤路線：找今天 task_stops 中
    //   - 狀態 != completed/skipped
    //   - 且 planned_arrival_at 已過 + 15 分鐘
    // 依 driver 聚合
    const delayedRoutes = await computeDelayedRoutes(admin, kpi.snapshot_date);

    const inputSnapshot = {
      kpi,
      delayed_routes: delayedRoutes,
      client_context: body?.context ?? {}
    };

    const { data: reqRow, error: reqErr } = await admin
      .from("ai_analysis_requests")
      .insert({
        requested_by: ctx.userId,
        scope,
        scope_ref_id: body?.scope_ref_id ?? null,
        status: "pending",
        input_snapshot: inputSnapshot
      })
      .select("id")
      .single();
    if (reqErr || !reqRow) throw reqErr ?? new Error("Failed to create request");

    try {
      const analysis = await aiService.analyzeDeliveryStatus({
        scope,
        scope_ref_id: body?.scope_ref_id,
        context: {
          completion_rate: kpi.completion_rate,
          on_time_rate: kpi.on_time_rate,
          exception_count: kpi.exception_count,
          delayed_routes: delayedRoutes
        }
      });

      await admin
        .from("ai_analysis_requests")
        .update({
          status: "completed",
          output_analysis: analysis,
          completed_at: new Date().toISOString(),
          model_version: "mock-v0"
        })
        .eq("id", reqRow.id);

      return ok({ requestId: reqRow.id, analysis });
    } catch (innerErr) {
      await admin
        .from("ai_analysis_requests")
        .update({
          status: "failed",
          error_message: innerErr instanceof Error ? innerErr.message : "unknown"
        })
        .eq("id", reqRow.id);
      throw innerErr;
    }
  } catch (e) {
    return handleApiError(e);
  }
}

/**
 * GET /api/manager/ai-analysis  — 歷史紀錄
 */
export async function GET() {
  try {
    await requireManager();
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("ai_analysis_requests")
      .select("id, scope, status, output_analysis, created_at, completed_at, model_version")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return ok({ requests: data ?? [] });
  } catch (e) {
    return handleApiError(e);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function computeDelayedRoutes(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  date: string
): Promise<Array<{
  driver_name: string;
  route_name: string;
  delayed_stops: number;
  estimated_delay_minutes: number;
}>> {
  interface TaskWithRelations {
    id: string;
    driver: { full_name: string } | { full_name: string }[] | null;
    assignment: { route_name: string } | { route_name: string }[] | null;
  }
  interface TaskStopMini {
    delivery_task_id: string;
    status: string;
    planned_arrival_at: string | null;
    actual_arrival_at: string | null;
    on_time: boolean | null;
  }

  const { data: tasks } = await admin
    .from("delivery_tasks")
    .select(
      "id, driver:profiles(full_name)," +
        " assignment:driver_route_assignments(route_name)"
    )
    .eq("delivery_date", date)
    .returns<TaskWithRelations[]>();

  if (!tasks || tasks.length === 0) return [];

  const taskIds = tasks.map((t) => t.id);
  const { data: stops } = await admin
    .from("delivery_task_stops")
    .select("delivery_task_id, status, planned_arrival_at, actual_arrival_at, on_time")
    .in("delivery_task_id", taskIds)
    .returns<TaskStopMini[]>();

  const now = Date.now();
  const result: Array<{
    driver_name: string;
    route_name: string;
    delayed_stops: number;
    estimated_delay_minutes: number;
  }> = [];

  for (const t of tasks) {
    const taskStops = (stops ?? []).filter((s) => s.delivery_task_id === t.id);
    let delayedCount = 0;
    let maxDelayMin = 0;
    for (const s of taskStops) {
      if (s.status === "completed" || s.status === "skipped") {
        if (s.on_time === false) {
          delayedCount++;
        }
        continue;
      }
      if (!s.planned_arrival_at) continue;
      const planned = new Date(s.planned_arrival_at).getTime();
      const reference = s.actual_arrival_at
        ? new Date(s.actual_arrival_at).getTime()
        : now;
      const diffMin = Math.round((reference - planned) / 60_000);
      if (diffMin > 15) {
        delayedCount++;
        if (diffMin > maxDelayMin) maxDelayMin = diffMin;
      }
    }
    if (delayedCount > 0) {
      const driverObj = Array.isArray(t.driver) ? t.driver[0] : t.driver;
      const assignObj = Array.isArray(t.assignment) ? t.assignment[0] : t.assignment;
      result.push({
        driver_name: driverObj?.full_name ?? "(未知)",
        route_name: assignObj?.route_name ?? "—",
        delayed_stops: delayedCount,
        estimated_delay_minutes: maxDelayMin
      });
    }
  }
  return result;
}

import { requireManager } from "@/lib/auth/server-auth";
import { ok, handleApiError } from "@/lib/api/response";
import { orPlanningService } from "@/lib/services/or-planning-service";
import { routePlanService } from "@/lib/services/route-plan-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/manager/or-jobs/[id]/materialize-and-publish
 *   一鍵採用試算結果 + 發布 + 展開成今日 delivery_tasks：
 *     1. convertOutputToRoutePlan → draft route_plan + route_stops（含全部 34 站）
 *     2. publishPlan → 把該 plan 設為 published（同 period 其它 published → archived）
 *     3. generateDailyTasksFromPublished → 為今日尚未建 task 的 driver 建 delivery_tasks +
 *        delivery_task_stops（讓 dashboard 站數能對齊規劃路線數）
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireManager();
    const { id } = await context.params;

    const { routePlanId } = await orPlanningService.convertOutputToRoutePlan(id, ctx.userId);
    await routePlanService.publishPlan(routePlanId);
    const { tasksCreated } =
      await routePlanService.generateDailyTasksFromPublished(routePlanId);

    return ok({
      jobId: id,
      routePlanId,
      status: "published",
      tasksCreated
    });
  } catch (e) {
    return handleApiError(e);
  }
}

import { requireManager } from "@/lib/auth/server-auth";
import { ok, handleApiError } from "@/lib/api/response";
import { orPlanningService } from "@/lib/services/or-planning-service";
import { routePlanService } from "@/lib/services/route-plan-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/manager/or-jobs/[id]/materialize-and-publish
 *   一鍵採用試算結果 + 發布：
 *     1. convertOutputToRoutePlan → draft route_plan
 *     2. publishPlan → 把該 plan 設為 published（同 period 其它 published → archived）
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

    return ok({ jobId: id, routePlanId, status: "published" });
  } catch (e) {
    return handleApiError(e);
  }
}

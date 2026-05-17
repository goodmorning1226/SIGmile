import { requireManager } from "@/lib/auth/server-auth";
import { ok, handleApiError } from "@/lib/api/response";
import { orPlanningService } from "@/lib/services/or-planning-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/manager/or-jobs/[id]/materialize
 *   把 OR job 的 output_plan 轉成 draft route_plan v(n+1) + assignments + route_stops。
 *   完成後 job.created_route_plan_id 會被填上。
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireManager();
    const { id } = await context.params;
    const { routePlanId } = await orPlanningService.convertOutputToRoutePlan(id, ctx.userId);
    return ok({ jobId: id, routePlanId });
  } catch (e) {
    return handleApiError(e);
  }
}

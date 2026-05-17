import { requireManager } from "@/lib/auth/server-auth";
import { ok, handleApiError } from "@/lib/api/response";
import { routePlanService } from "@/lib/services/route-plan-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/manager/route-plans/[id]/publish
 * 把指定 draft route_plan 設為 published，同 period 其它已 published 自動 archived。
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireManager();
    const { id } = await context.params;
    await routePlanService.publishPlan(id);
    return ok({ id, status: "published" });
  } catch (e) {
    return handleApiError(e);
  }
}

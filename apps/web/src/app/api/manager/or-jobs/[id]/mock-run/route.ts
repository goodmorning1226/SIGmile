import { requireManager } from "@/lib/auth/server-auth";
import { ok, handleApiError } from "@/lib/api/response";
import { orPlanningService } from "@/lib/services/or-planning-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/manager/or-jobs/[id]/mock-run
 *   觸發 mock OR engine：用 round-robin 將 stops 派給 drivers，把 output_plan 寫回 job。
 *   ★ 真實 OR engine 替換點：or-planning-service.ts → MockORPlanningService → RealORPlanningService。
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireManager();
    const { id } = await context.params;
    const result = await orPlanningService.runMockPlanningJob(id);
    return ok({ jobId: id, output_plan: result.output_plan });
  } catch (e) {
    return handleApiError(e);
  }
}

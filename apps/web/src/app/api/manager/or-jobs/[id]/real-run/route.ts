import { requireManager } from "@/lib/auth/server-auth";
import { ok, handleApiError } from "@/lib/api/response";
import { orPlanningService } from "@/lib/services/or-planning-service";

export const dynamic = "force-dynamic";
// Gurobi solve 可能跑十幾秒～數分鐘，allow 長一點
export const maxDuration = 300;

/**
 * POST /api/manager/or-jobs/[id]/real-run
 *   呼叫 or-engine/solver_main.py 跑真實 Gurobi。
 *   如果 Python / Gurobi 不可用，會自動 fallback 跑 mock。
 *   回傳 { engine_used: "gurobi" | "mock-fallback", output_plan: OrOutputPlanV2 }。
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireManager();
    const { id } = await context.params;
    const result = await orPlanningService.runRealPlanningJob(id);
    return ok({
      jobId: id,
      engine_used: result.engine_used,
      output_plan: result.output_plan,
      fallback_reason: result.fallback_reason,
      diagnostics: result.diagnostics
    });
  } catch (e) {
    return handleApiError(e);
  }
}

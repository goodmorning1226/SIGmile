import { requireManager } from "@/lib/auth/server-auth";
import { ok, fail, handleApiError } from "@/lib/api/response";
import { applyUrgentDispatch } from "@/lib/services/urgent-dispatch-service";

export const dynamic = "force-dynamic";

/** POST /api/manager/urgent/[id]/apply — 把急件實際插進該 driver 今日任務 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireManager();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    if (!body?.driver_id) return fail("BAD_REQUEST", "driver_id 為必填", 400);
    const result = await applyUrgentDispatch(id, body.driver_id);
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}

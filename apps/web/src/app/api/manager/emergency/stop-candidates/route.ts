import { requireManager } from "@/lib/auth/server-auth";
import { ok, fail, handleApiError } from "@/lib/api/response";
import { suggestDriversForStop } from "@/lib/services/emergency-reroute-service";

export const dynamic = "force-dynamic";

/** POST /api/manager/emergency/stop-candidates — 給單一 task_stop 算候選 driver 排名 */
export async function POST(request: Request) {
  try {
    await requireManager();
    const body = await request.json().catch(() => ({}));
    if (!body?.task_stop_id) return fail("BAD_REQUEST", "task_stop_id 必填", 400);
    if (!body?.exclude_driver_id) return fail("BAD_REQUEST", "exclude_driver_id 必填", 400);
    const result = await suggestDriversForStop({
      task_stop_id: body.task_stop_id,
      exclude_driver_id: body.exclude_driver_id,
      date: body.date
    });
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}

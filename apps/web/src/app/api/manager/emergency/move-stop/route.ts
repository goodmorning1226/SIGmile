import { requireManager } from "@/lib/auth/server-auth";
import { ok, fail, handleApiError } from "@/lib/api/response";
import { moveStopToDriver } from "@/lib/services/emergency-reroute-service";

export const dynamic = "force-dynamic";

/** POST /api/manager/emergency/move-stop — 把單一 task_stop 搬到目標 driver */
export async function POST(request: Request) {
  try {
    await requireManager();
    const body = await request.json().catch(() => ({}));
    if (!body?.task_stop_id) return fail("BAD_REQUEST", "task_stop_id 必填", 400);
    if (!body?.target_driver_id) return fail("BAD_REQUEST", "target_driver_id 必填", 400);
    const result = await moveStopToDriver({
      task_stop_id: body.task_stop_id,
      target_driver_id: body.target_driver_id,
      date: body.date
    });
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}

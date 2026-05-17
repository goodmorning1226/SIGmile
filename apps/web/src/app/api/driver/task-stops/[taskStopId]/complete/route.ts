import { requireDriver } from "@/lib/auth/bearer-auth";
import { success, handleDriverError } from "@/lib/api/driver-response";
import {
  advanceTaskCurrentStop,
  getTaskIdOfStop
} from "@/lib/services/delivery-task-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/driver/task-stops/[taskStopId]/complete
 *   - status = completed, completed_at = now()
 *   - confirmed_at = now() (作為「門市簽收」時間，沒有單獨 UI)
 *   - 推進到下一個 pending stop；若全部完成則 task = completed
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ taskStopId: string }> }
) {
  try {
    const ctx = await requireDriver(request);
    const { taskStopId } = await context.params;

    const meta = await getTaskIdOfStop(ctx.supabase, taskStopId);
    const nowIso = new Date().toISOString();

    const { data, error } = await ctx.supabase
      .from("delivery_task_stops")
      .update({
        status: "completed",
        completed_at: nowIso,
        confirmed_at: nowIso
      })
      .eq("id", taskStopId)
      .select("id, status, completed_at")
      .single();
    if (error || !data) throw new Error("NOT_FOUND");

    const advance = await advanceTaskCurrentStop(ctx.supabase, meta.taskId);

    return success({ task_stop: data, task_advance: advance });
  } catch (e) {
    return handleDriverError(e);
  }
}

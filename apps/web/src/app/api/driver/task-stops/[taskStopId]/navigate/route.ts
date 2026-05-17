import { requireDriver } from "@/lib/auth/bearer-auth";
import { success, handleDriverError } from "@/lib/api/driver-response";
import { getTaskIdOfStop } from "@/lib/services/delivery-task-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/driver/task-stops/[taskStopId]/navigate
 *   把 stop status 設為 navigating。
 *   未來會在這裡呼叫 GoogleNavigationService 取得導航 URL / ETA。
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ taskStopId: string }> }
) {
  try {
    const ctx = await requireDriver(request);
    const { taskStopId } = await context.params;

    // 驗證 stop 屬於這位 driver；同時取得 task_id 之後同步 task.current_stop_id。
    const meta = await getTaskIdOfStop(ctx.supabase, taskStopId);

    const { data, error } = await ctx.supabase
      .from("delivery_task_stops")
      .update({ status: "navigating" })
      .eq("id", taskStopId)
      .select("id, status")
      .single();
    if (error || !data) throw new Error("NOT_FOUND");

    // 同步 task.current_stop_id 指向這站（並把 pending 自動升 in_progress）
    await ctx.supabase
      .from("delivery_tasks")
      .update({ current_stop_id: meta.stopId, status: "in_progress" })
      .eq("id", meta.taskId)
      .eq("driver_id", ctx.userId);

    // 未來在此處呼叫 GoogleNavigationService 取得 deep-link / 預估抵達；目前回 placeholder
    return success({
      task_stop: data,
      navigation: {
        provider: "mock",
        message: "未來將回傳 Google Maps Navigation URL"
      }
    });
  } catch (e) {
    return handleDriverError(e);
  }
}

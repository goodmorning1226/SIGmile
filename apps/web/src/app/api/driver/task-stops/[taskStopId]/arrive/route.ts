import { requireDriver } from "@/lib/auth/bearer-auth";
import { success, handleDriverError } from "@/lib/api/driver-response";
import { getTaskIdOfStop } from "@/lib/services/delivery-task-service";

export const dynamic = "force-dynamic";

const ON_TIME_GRACE_MINUTES = 10;

/**
 * POST /api/driver/task-stops/[taskStopId]/arrive
 *   - status = arrived
 *   - actual_arrival_at = now()
 *   - on_time = actual_arrival_at <= planned_arrival_at + 10min
 *   - 同步 delivery_tasks.current_stop_id 指向這站
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ taskStopId: string }> }
) {
  try {
    const ctx = await requireDriver(request);
    const { taskStopId } = await context.params;

    const meta = await getTaskIdOfStop(ctx.supabase, taskStopId);

    const now = new Date();
    const nowIso = now.toISOString();

    let onTime: boolean | null = null;
    if (meta.plannedArrivalAt) {
      const planned = new Date(meta.plannedArrivalAt);
      const cutoff = planned.getTime() + ON_TIME_GRACE_MINUTES * 60_000;
      onTime = now.getTime() <= cutoff;
    }

    const { data, error } = await ctx.supabase
      .from("delivery_task_stops")
      .update({
        status: "arrived",
        actual_arrival_at: nowIso,
        on_time: onTime,
        store_checkin_at: nowIso
      })
      .eq("id", taskStopId)
      .select(
        "id, status, actual_arrival_at, on_time, planned_arrival_at, store_checkin_at"
      )
      .single();
    if (error || !data) throw new Error("NOT_FOUND");

    await ctx.supabase
      .from("delivery_tasks")
      .update({ current_stop_id: meta.stopId, status: "in_progress" })
      .eq("id", meta.taskId)
      .eq("driver_id", ctx.userId);

    return success({ task_stop: data });
  } catch (e) {
    return handleDriverError(e);
  }
}

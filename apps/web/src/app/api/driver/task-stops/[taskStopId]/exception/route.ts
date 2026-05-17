import { requireDriver } from "@/lib/auth/bearer-auth";
import { success, failure, handleDriverError } from "@/lib/api/driver-response";
import {
  advanceTaskCurrentStop,
  getTaskIdOfStop
} from "@/lib/services/delivery-task-service";

export const dynamic = "force-dynamic";

const ALLOWED_REASONS = [
  "traffic_delay",
  "store_closed",
  "no_parking",
  "cargo_issue",
  "customer_issue",
  "other"
] as const;

/**
 * POST /api/driver/task-stops/[taskStopId]/exception
 *   body: { reason, note? }
 *   - status = failed
 *   - exception_reason / exception_note
 *   - completed_at = now() (用作「結案時間」；schema 沒有 failed_at 欄位)
 *   - 推進 task.current_stop_id 到下一站
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ taskStopId: string }> }
) {
  try {
    const ctx = await requireDriver(request);
    const { taskStopId } = await context.params;

    const body = (await request.json().catch(() => ({}))) as {
      reason?: string;
      note?: string;
    };
    const reason = body.reason ?? "";
    if (!ALLOWED_REASONS.includes(reason as (typeof ALLOWED_REASONS)[number])) {
      return failure(
        `reason 必須是 ${ALLOWED_REASONS.join(" / ")} 其中之一`,
        400
      );
    }

    const meta = await getTaskIdOfStop(ctx.supabase, taskStopId);
    const nowIso = new Date().toISOString();

    const { data, error } = await ctx.supabase
      .from("delivery_task_stops")
      .update({
        status: "failed",
        exception_reason: reason,
        exception_note: body.note ?? null,
        completed_at: nowIso
      })
      .eq("id", taskStopId)
      .select("id, status, exception_reason, exception_note, completed_at")
      .single();
    if (error || !data) throw new Error("NOT_FOUND");

    const advance = await advanceTaskCurrentStop(ctx.supabase, meta.taskId);

    return success({ task_stop: data, task_advance: advance });
  } catch (e) {
    return handleDriverError(e);
  }
}

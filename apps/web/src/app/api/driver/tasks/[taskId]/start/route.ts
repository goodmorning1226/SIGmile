import { requireDriver } from "@/lib/auth/bearer-auth";
import { success, handleDriverError } from "@/lib/api/driver-response";

export const dynamic = "force-dynamic";

/**
 * POST /api/driver/tasks/[taskId]/start
 * 1) 把 delivery_tasks.status = in_progress, started_at = now()
 * 2) 把同 task 還沒 upload 的 task_stops 一律標 uploaded_at = now()
 *    語意：driver 按下「開始配送」= 貨物已從配送中心上車，今天每一站的貨已 uploaded。
 *    這也讓 dashboard 的「已上傳門市數」KPI 能真正動起來。
 *
 * RLS 已限制 driver 只能改自己的 task / 自己 task 底下的 stops。
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  try {
    const ctx = await requireDriver(request);
    const { taskId } = await context.params;

    const nowIso = new Date().toISOString();

    const { data, error } = await ctx.supabase
      .from("delivery_tasks")
      .update({
        status: "in_progress",
        started_at: nowIso
      })
      .eq("id", taskId)
      .eq("driver_id", ctx.userId)
      .select("id, status, started_at")
      .single();
    if (error || !data) throw new Error("NOT_FOUND");

    // 順手蓋上 uploaded_at（只蓋還沒有值的）
    const { error: upErr } = await ctx.supabase
      .from("delivery_task_stops")
      .update({ uploaded_at: nowIso })
      .eq("delivery_task_id", taskId)
      .is("uploaded_at", null);
    if (upErr) {
      // 不阻斷主要流程，只記 log
      console.error("[driver/start] uploaded_at backfill failed", upErr);
    }

    return success({ task: data });
  } catch (e) {
    return handleDriverError(e);
  }
}

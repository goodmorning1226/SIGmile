import { requireDriver } from "@/lib/auth/bearer-auth";
import { success, handleDriverError } from "@/lib/api/driver-response";

export const dynamic = "force-dynamic";

/**
 * POST /api/dev/reset-today
 *
 * Dev-only：把當前 driver 最近一筆 delivery_task 的所有 stops 重設為 pending，
 *           清掉 actual_arrival_at / completed_at / exception_*；task.status 設為 in_progress。
 *
 * 用途：demo 跑完一輪後，想再 demo 一次不用重新 seed。
 *
 * 只在 NODE_ENV != production 下運作；production 一律 403。
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return new Response(
      JSON.stringify({ success: false, error: "dev-only endpoint" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const ctx = await requireDriver(request);

    // 找最近一筆 task（不限日期）
    const { data: latest, error: latestErr } = await ctx.supabase
      .from("delivery_tasks")
      .select("id, delivery_date, current_stop_id")
      .eq("driver_id", ctx.userId)
      .order("delivery_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestErr) throw latestErr;
    if (!latest) {
      return success({ reset: false, reason: "no task found for this driver" });
    }

    // 1) 重置該 task 的所有 stops
    const { error: stopsErr } = await ctx.supabase
      .from("delivery_task_stops")
      .update({
        status: "pending",
        actual_arrival_at: null,
        completed_at: null,
        on_time: null,
        exception_reason: null,
        exception_note: null,
        store_checkin_at: null,
        confirmed_at: null,
        uploaded_at: null
      })
      .eq("delivery_task_id", latest.id);
    if (stopsErr) throw stopsErr;

    // 2) task.current_stop_id 清掉 + status 回 in_progress（讓 driver 可以重新開始）
    const { error: taskErr } = await ctx.supabase
      .from("delivery_tasks")
      .update({
        status: "in_progress",
        current_stop_id: null,
        started_at: null,
        completed_at: null
      })
      .eq("id", latest.id);
    if (taskErr) throw taskErr;

    return success({
      reset: true,
      task_id: latest.id,
      delivery_date: latest.delivery_date,
      message: "All stops reset to pending. You can now re-test from /today."
    });
  } catch (e) {
    return handleDriverError(e);
  }
}

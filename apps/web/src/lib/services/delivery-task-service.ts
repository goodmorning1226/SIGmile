import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Driver 端共用：當一個 stop 從 pending/navigating/arrived 變成 completed 或 failed/skipped 後，
 * 把 delivery_tasks.current_stop_id 推到下一個尚未做完的 stop。
 * 若都做完了，把 task.status 收成 'completed'。
 *
 * 傳入呼叫端的 supabase client（Bearer-bound），RLS 自動限制只能操作自己的 task。
 */
export async function advanceTaskCurrentStop(
  supabase: SupabaseClient,
  taskId: string
): Promise<{ currentStopId: string | null; finished: boolean }> {
  const { data: stops, error } = await supabase
    .from("delivery_task_stops")
    .select("id, stop_id, status, stop_order")
    .eq("delivery_task_id", taskId)
    .order("stop_order", { ascending: true });
  if (error) throw error;

  const stillOpen = (stops ?? []).find(
    (s) =>
      s.status === "pending" ||
      s.status === "navigating" ||
      s.status === "arrived"
  );

  if (stillOpen) {
    const { error: upErr } = await supabase
      .from("delivery_tasks")
      .update({
        current_stop_id: stillOpen.stop_id,
        status: "in_progress"
      })
      .eq("id", taskId);
    if (upErr) throw upErr;
    return { currentStopId: stillOpen.stop_id as string, finished: false };
  }

  const { error: doneErr } = await supabase
    .from("delivery_tasks")
    .update({
      current_stop_id: null,
      status: "completed",
      completed_at: new Date().toISOString()
    })
    .eq("id", taskId);
  if (doneErr) throw doneErr;
  return { currentStopId: null, finished: true };
}

/** 從 task_stop 反查 delivery_task_id（同時驗證使用者透過 RLS 看得到這筆）。 */
export async function getTaskIdOfStop(
  supabase: SupabaseClient,
  taskStopId: string
): Promise<{ taskId: string; stopId: string; plannedArrivalAt: string | null }> {
  const { data, error } = await supabase
    .from("delivery_task_stops")
    .select("delivery_task_id, stop_id, planned_arrival_at")
    .eq("id", taskStopId)
    .single();
  if (error || !data) throw new Error("NOT_FOUND");
  return {
    taskId: data.delivery_task_id as string,
    stopId: data.stop_id as string,
    plannedArrivalAt: (data.planned_arrival_at as string | null) ?? null
  };
}

/** Asia/Taipei 今天的 yyyy-MM-dd。 */
export function todayInTaipei(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.APP_TIMEZONE ?? "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

import { requireDriver } from "@/lib/auth/bearer-auth";
import { success, handleDriverError } from "@/lib/api/driver-response";
import { todayInTaipei } from "@/lib/services/delivery-task-service";

export const dynamic = "force-dynamic";

/* ----- 本檔用的 row 型別（在 supabase gen types 完成前） ----- */
interface StopRow {
  id: string;
  external_code: string | null;
  name: string;
  stop_type: string;
  address: string;
  lat: number | null;
  lng: number | null;
  time_window_start: string | null;
  time_window_end: string | null;
  default_service_minutes: number;
  contact_name: string | null;
  contact_phone: string | null;
  notes: string | null;
}
interface TaskStopRow {
  id: string;
  delivery_task_id: string;
  route_stop_id: string | null;
  stop_id: string;
  stop_order: number;
  status: string;
  planned_arrival_at: string | null;
  actual_arrival_at: string | null;
  completed_at: string | null;
  on_time: boolean | null;
  uploaded_at: string | null;
  store_checkin_at: string | null;
  confirmed_at: string | null;
  exception_reason: string | null;
  exception_note: string | null;
  stop: StopRow | null;
}
interface TaskRow {
  id: string;
  delivery_date: string;
  driver_id: string;
  driver_route_assignment_id: string | null;
  status: string;
  current_stop_id: string | null;
  started_at: string | null;
  completed_at: string | null;
}

/**
 * GET /api/driver/today
 * 回傳：
 *   data: {
 *     task: <delivery_tasks row> | null,
 *     stops: [<delivery_task_stops row with stop joined>...],
 *     progress: { completed, total },
 *     current_stop: <task stop row> | null,
 *     next_stop: <task stop row> | null
 *   }
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireDriver(request);

    const { data: task, error: taskErr } = await ctx.supabase
      .from("delivery_tasks")
      .select(
        "id, delivery_date, driver_id, driver_route_assignment_id, status, " +
          "current_stop_id, started_at, completed_at"
      )
      .eq("driver_id", ctx.userId)
      .eq("delivery_date", todayInTaipei())
      .maybeSingle<TaskRow>();
    if (taskErr) throw taskErr;

    // ★ Dev fallback ★
    // 找不到「今日」的任務時，若 NODE_ENV != production，自動回**最近一筆**任務，
    // 讓 demo / 測試階段不用每天 re-seed。Production 仍會回空（行為不變）。
    let effectiveTask: TaskRow | null = task ?? null;
    let usedDevFallback = false;
    if (!effectiveTask && process.env.NODE_ENV !== "production") {
      const { data: latest, error: latestErr } = await ctx.supabase
        .from("delivery_tasks")
        .select(
          "id, delivery_date, driver_id, driver_route_assignment_id, status, " +
            "current_stop_id, started_at, completed_at"
        )
        .eq("driver_id", ctx.userId)
        .order("delivery_date", { ascending: false })
        .limit(1)
        .maybeSingle<TaskRow>();
      if (latestErr) throw latestErr;
      if (latest) {
        effectiveTask = latest;
        usedDevFallback = true;
        console.warn(
          `[dev-fallback] /api/driver/today: no task for ${todayInTaipei()}, ` +
            `using latest task ${latest.id} (delivery_date=${latest.delivery_date})`
        );
      }
    }

    if (!effectiveTask) {
      return success({
        task: null,
        stops: [],
        progress: { completed: 0, total: 0 },
        current_stop: null,
        next_stop: null,
        dev_fallback: false
      });
    }
    const task2 = effectiveTask; // rename for readability below

    const { data: stopsData, error: stopsErr } = await ctx.supabase
      .from("delivery_task_stops")
      .select(
        "id, delivery_task_id, route_stop_id, stop_id, stop_order, status, " +
          "planned_arrival_at, actual_arrival_at, completed_at, on_time, " +
          "uploaded_at, store_checkin_at, confirmed_at, " +
          "exception_reason, exception_note, " +
          "stop:stops(id, external_code, name, stop_type, address, lat, lng, " +
          "time_window_start, time_window_end, default_service_minutes, " +
          "contact_name, contact_phone, notes)"
      )
      .eq("delivery_task_id", task2.id)
      .order("stop_order", { ascending: true })
      .returns<TaskStopRow[]>();
    if (stopsErr) throw stopsErr;

    const stops: TaskStopRow[] = stopsData ?? [];
    const completed = stops.filter((s) => s.status === "completed").length;

    const isOpen = (s: { status: string }) =>
      s.status === "pending" ||
      s.status === "navigating" ||
      s.status === "arrived";

    // 用 stop_id 找 currentStop。同 route 重複造訪同一 stop_id 的進階情境
    // 之後改 delivery_tasks.current_task_stop_id（FK 到 delivery_task_stops.id）會更精準；
    // 目前 demo 路線沒有重複，先用 stop_id。
    const currentStop =
      stops.find((s) => s.stop_id === task2.current_stop_id) ?? null;

    // next_stop = 嚴格在 current 之後（stop_order 較大）且仍未結案的第一筆
    //              若 current 為 null，回第一個未結案的 stop
    const nextStop = currentStop
      ? stops.find((s) => s.stop_order > currentStop.stop_order && isOpen(s)) ?? null
      : stops.find(isOpen) ?? null;

    return success({
      task: task2,
      stops,
      progress: { completed, total: stops.length },
      current_stop: currentStop,
      next_stop: nextStop,
      dev_fallback: usedDevFallback
    });
  } catch (e) {
    return handleDriverError(e);
  }
}

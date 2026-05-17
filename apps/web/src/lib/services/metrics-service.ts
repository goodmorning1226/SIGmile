import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DashboardKpi } from "@/types/domain";

/**
 * 集中計算當日營運指標。直接從 delivery_tasks / delivery_task_stops 即時 aggregate；
 * 之後若要快照可改寫到 delivery_metrics_snapshots（schema 已備好）。
 */
export class MetricsService {
  /**
   * 取得指定日期（預設今天，台北時區）的 KPI。
   */
  async getDashboardKpi(date?: string): Promise<DashboardKpi> {
    const supabase = await createSupabaseServerClient();
    const target = date ?? todayInTaipei();

    const { data: tasks, error: tErr } = await supabase
      .from("delivery_tasks")
      .select("id, driver_id, status")
      .eq("delivery_date", target);
    if (tErr) throw tErr;

    const taskIds = (tasks ?? []).map((t) => t.id);
    if (taskIds.length === 0) {
      return emptyKpi(target);
    }

    const { data: stops, error: sErr } = await supabase
      .from("delivery_task_stops")
      .select("id, status, on_time, uploaded_at, store_checkin_at, exception_reason, planned_arrival_at")
      .in("delivery_task_id", taskIds);
    if (sErr) throw sErr;

    const total = stops?.length ?? 0;
    let completed = 0;
    let uploaded  = 0;
    let arrived   = 0;
    let onTime    = 0;
    let exceptions = 0;
    for (const s of stops ?? []) {
      if (s.status === "completed") completed++;
      if (s.uploaded_at)             uploaded++;
      if (s.store_checkin_at)        arrived++;
      if (s.on_time)                 onTime++;
      if (s.exception_reason || s.status === "failed") exceptions++;
    }

    const inProgressDrivers = (tasks ?? []).filter((t) => t.status === "in_progress").length;

    return {
      completion_rate:        safeRate(completed, total),
      store_arrival_rate:     safeRate(arrived, total),
      on_time_rate:           safeRate(onTime, arrived),
      uploaded_store_count:   uploaded,
      arrived_store_count:    arrived,
      on_time_store_count:    onTime,
      total_stop_count:       total,
      in_progress_driver_count: inProgressDrivers,
      exception_count:        exceptions,
      snapshot_date:          target
    };
  }
}

function emptyKpi(date: string): DashboardKpi {
  return {
    completion_rate: 0,
    store_arrival_rate: 0,
    on_time_rate: 0,
    uploaded_store_count: 0,
    arrived_store_count: 0,
    on_time_store_count: 0,
    total_stop_count: 0,
    in_progress_driver_count: 0,
    exception_count: 0,
    snapshot_date: date
  };
}

function safeRate(n: number, d: number) {
  if (d <= 0) return 0;
  return Number((n / d).toFixed(4));
}

function todayInTaipei(): string {
  const tz = process.env.APP_TIMEZONE ?? "Asia/Taipei";
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit"
  });
  return fmt.format(new Date()); // yyyy-mm-dd
}

export const metricsService = new MetricsService();

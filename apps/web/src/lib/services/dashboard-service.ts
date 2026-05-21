import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DashboardKpi } from "@/types/domain";

/**
 * Dashboard 一站式 service：用一次 server client、一次 round-trip 抓 tasks+stops
 * 同時算 KPI + 圖表，避免之前 metrics-service 與 dashboard-charts-service
 * 各自重複 query 同一份資料。
 */

export interface HourlyPoint {
  hour: number;
  completed: number;
  cumulative: number;
}

export interface DriverRanking {
  driver_id: string;
  driver_name: string;
  employee_code: string | null;
  completed: number;
  total: number;
  task_status: string;
  exceptions: number;
}

export interface StatusBreakdown {
  pending: number;
  navigating: number;
  arrived: number;
  completed: number;
  failed: number;
  skipped: number;
}

export interface DashboardCharts {
  hourly: HourlyPoint[];
  drivers: DriverRanking[];
  status: StatusBreakdown;
  date: string;
}

export interface DashboardBundle {
  kpi: DashboardKpi;
  charts: DashboardCharts;
}

interface TaskRow {
  id: string;
  driver_id: string;
  status: string;
  driver:
    | { full_name: string; employee_code: string | null }
    | { full_name: string; employee_code: string | null }[]
    | null;
}
interface StopRow {
  delivery_task_id: string;
  status: string;
  completed_at: string | null;
  on_time: boolean | null;
  uploaded_at: string | null;
  store_checkin_at: string | null;
  exception_reason: string | null;
}

function pickFirst<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function todayInTaipei(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.APP_TIMEZONE ?? "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

function safeRate(n: number, d: number) {
  if (d <= 0) return 0;
  return Number((n / d).toFixed(4));
}

export async function getDashboardBundle(date?: string): Promise<DashboardBundle> {
  const supabase = await createSupabaseServerClient();
  const target = date ?? todayInTaipei();

  // 1. tasks（一次）
  const { data: tasks } = await supabase
    .from("delivery_tasks")
    .select("id, driver_id, status, driver:profiles(full_name, employee_code)")
    .eq("delivery_date", target)
    .returns<TaskRow[]>();
  const taskList = tasks ?? [];

  if (taskList.length === 0) {
    return {
      kpi: {
        completion_rate: 0, store_arrival_rate: 0, on_time_rate: 0,
        uploaded_store_count: 0, arrived_store_count: 0, on_time_store_count: 0,
        total_stop_count: 0, in_progress_driver_count: 0, exception_count: 0,
        snapshot_date: target
      },
      charts: {
        hourly: emptyHourly(), drivers: [],
        status: { pending: 0, navigating: 0, arrived: 0, completed: 0, failed: 0, skipped: 0 },
        date: target
      }
    };
  }

  // 2. stops（一次抓全部欄位，給 KPI 和 charts 共用）
  const taskIds = taskList.map((t) => t.id);
  const { data: stops } = await supabase
    .from("delivery_task_stops")
    .select(
      "delivery_task_id, status, on_time, completed_at, uploaded_at, " +
        "store_checkin_at, exception_reason"
    )
    .in("delivery_task_id", taskIds)
    .returns<StopRow[]>();
  const stopList = stops ?? [];

  // ----- KPI -----
  const total = stopList.length;
  let completed = 0, uploaded = 0, arrived = 0, onTime = 0, exceptions = 0;
  for (const s of stopList) {
    if (s.status === "completed") completed++;
    if (s.uploaded_at)            uploaded++;
    if (s.store_checkin_at)       arrived++;
    if (s.on_time)                onTime++;
    if (s.exception_reason || s.status === "failed") exceptions++;
  }
  const inProgressDrivers = taskList.filter((t) => t.status === "in_progress").length;

  const kpi: DashboardKpi = {
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

  // ----- charts: driver ranking -----
  const drivers: DriverRanking[] = taskList.map((t) => {
    const owns = stopList.filter((s) => s.delivery_task_id === t.id);
    const driver = pickFirst(t.driver);
    return {
      driver_id: t.driver_id,
      driver_name: driver?.full_name ?? "(未知)",
      employee_code: driver?.employee_code ?? null,
      completed: owns.filter((s) => s.status === "completed").length,
      total: owns.length,
      task_status: t.status,
      exceptions: owns.filter((s) => s.status === "failed").length
    };
  });
  drivers.sort((a, b) => {
    const ra = a.total === 0 ? 0 : a.completed / a.total;
    const rb = b.total === 0 ? 0 : b.completed / b.total;
    return rb - ra;
  });

  // ----- charts: status breakdown -----
  const status: StatusBreakdown = {
    pending: 0, navigating: 0, arrived: 0,
    completed: 0, failed: 0, skipped: 0
  };
  for (const s of stopList) {
    if (s.status in status) {
      (status as unknown as Record<string, number>)[s.status] += 1;
    }
  }

  // ----- charts: hourly -----
  const tz = process.env.APP_TIMEZONE ?? "Asia/Taipei";
  const hourCount = new Array<number>(24).fill(0);
  const hourFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", hour12: false
  });
  for (const s of stopList) {
    if (s.status !== "completed" || !s.completed_at) continue;
    const h = parseInt(hourFmt.format(new Date(s.completed_at)), 10);
    if (!Number.isNaN(h)) hourCount[h] += 1;
  }
  const hourly: HourlyPoint[] = [];
  let cum = 0;
  for (let h = 6; h <= 22; h++) {
    cum += hourCount[h];
    hourly.push({ hour: h, completed: hourCount[h], cumulative: cum });
  }

  return {
    kpi,
    charts: { hourly, drivers, status, date: target }
  };
}

function emptyHourly(): HourlyPoint[] {
  const out: HourlyPoint[] = [];
  for (let h = 6; h <= 22; h++) {
    out.push({ hour: h, completed: 0, cumulative: 0 });
  }
  return out;
}

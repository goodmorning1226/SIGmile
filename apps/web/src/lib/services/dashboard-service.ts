import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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

  // ★ 沒今日 task → 退回看「目前 published 路線方案」的展開資料
  //   (使用者剛發布、還沒展開成 today's delivery_tasks，或還沒到當天)
  //   這樣總覽至少能顯示「方案規劃的 N 站，完成 0/N」而不是全空。
  if (taskList.length === 0) {
    return getPublishedPlanBundle(target);
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

/**
 * Fallback：當「目標日期沒任何 delivery_tasks」時，從「目前 published 路線方案」
 * 反推應該要送的站數 / 司機數，當作「今日預定」顯示出來。
 *
 * 這樣 dashboard / 季度分析等視覺化在主管按下「採用並發布」之前就會立刻有資料，
 * 不會看起來像空頁面 → 也讓全站數字以「發布路線」為主來源對齊。
 */
async function getPublishedPlanBundle(target: string): Promise<DashboardBundle> {
  const admin = createSupabaseAdminClient();
  const empty: DashboardBundle = {
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

  // 最新的 published plan（最近發布的那一份）
  const { data: plan } = await admin
    .from("route_plans")
    .select("id")
    .eq("status", "published")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (!plan) return empty;

  // 撈所有 driver_route_assignments → route_stops 數
  interface AssignmentRow {
    id: string;
    driver_id: string | null;
    route_name: string;
    driver: { full_name: string; employee_code: string | null }
            | { full_name: string; employee_code: string | null }[] | null;
  }
  const { data: assignments } = await admin
    .from("driver_route_assignments")
    .select(
      "id, driver_id, route_name, " +
        "driver:profiles(full_name, employee_code)"
    )
    .eq("route_plan_id", plan.id)
    .returns<AssignmentRow[]>();
  const aList = assignments ?? [];
  const assignmentIds = aList.map((a) => a.id);

  let plannedStops = 0;
  const perAssign = new Map<string, number>();
  if (assignmentIds.length > 0) {
    const { data: rs } = await admin
      .from("route_stops")
      .select("id, driver_route_assignment_id")
      .in("driver_route_assignment_id", assignmentIds);
    for (const r of (rs ?? []) as Array<{ id: string; driver_route_assignment_id: string }>) {
      plannedStops++;
      perAssign.set(r.driver_route_assignment_id, (perAssign.get(r.driver_route_assignment_id) ?? 0) + 1);
    }
  }

  const drivers: DriverRanking[] = aList
    .filter((a) => a.driver_id != null)
    .map((a) => {
      const d = pickFirst(a.driver);
      const total = perAssign.get(a.id) ?? 0;
      return {
        driver_id: a.driver_id!,
        driver_name: d?.full_name ?? a.route_name ?? "(未指派)",
        employee_code: d?.employee_code ?? null,
        completed: 0,
        total,
        task_status: "pending",
        exceptions: 0
      };
    })
    .sort((a, b) => b.total - a.total);

  return {
    kpi: {
      ...empty.kpi,
      total_stop_count: plannedStops,
      in_progress_driver_count: 0
    },
    charts: {
      hourly: emptyHourly(),
      drivers,
      status: {
        pending: plannedStops, navigating: 0, arrived: 0,
        completed: 0, failed: 0, skipped: 0
      },
      date: target
    }
  };
}

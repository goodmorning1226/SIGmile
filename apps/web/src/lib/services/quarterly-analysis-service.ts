import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * 季度分析資料聚合：跨整季的 delivery_tasks + delivery_task_stops。
 *
 * 目的：給主管「跨季比較」+ 「季度內每月趨勢」+ 「重大延誤事件 TOP N」
 */

export interface QuarterlyKpi {
  quarter: string;          // e.g. "2026Q1"
  start_date: string;
  end_date: string;
  total_tasks: number;
  completed_tasks: number;
  total_stops: number;
  completed_stops: number;
  on_time_stops: number;
  exception_stops: number;
  completion_rate: number;
  on_time_rate: number;
  unique_drivers: number;
  unique_stores: number;
}

export interface MonthlyPoint {
  ym: string;               // "2026-01"
  completed: number;
  on_time: number;
  exceptions: number;
}

export interface DriverRank {
  driver_id: string;
  driver_name: string;
  employee_code: string | null;
  task_count: number;
  completed_stops: number;
  on_time_rate: number;
}

export interface ProblemStore {
  stop_id: string;
  stop_name: string;
  city: string | null;
  district: string | null;
  exception_count: number;
  late_count: number;
}

/** 站點狀態總分佈 — 用於季度版 StopStatusDonut */
export interface QuarterlyStatusBreakdown {
  pending: number;
  navigating: number;
  arrived: number;
  completed: number;
  failed: number;
  skipped: number;
}

export interface QuarterlyAnalysis {
  current: QuarterlyKpi;
  previous: QuarterlyKpi | null;  // 上一季比較
  monthly_trend: MonthlyPoint[];
  top_drivers: DriverRank[];
  problem_stores: ProblemStore[];
  /** 季內所有站點的最終狀態分佈（給 donut 用） */
  status_breakdown: QuarterlyStatusBreakdown;
}

/** 把 "2026Q1" 變 ["2026-01-01", "2026-03-31"] */
function quarterRange(q: string): { start: string; end: string } {
  const m = q.match(/^(\d{4})Q([1-4])$/);
  if (!m) throw new Error(`Invalid quarter: ${q}`);
  const year = parseInt(m[1], 10);
  const qn = parseInt(m[2], 10);
  const startMonth = (qn - 1) * 3;
  const endMonth = startMonth + 2;
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, endMonth + 1, 0));
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return { start: fmt(start), end: fmt(end) };
}

function prevQuarter(q: string): string {
  const m = q.match(/^(\d{4})Q([1-4])$/)!;
  let year = parseInt(m[1], 10);
  let qn = parseInt(m[2], 10);
  qn--;
  if (qn === 0) { qn = 4; year--; }
  return `${year}Q${qn}`;
}

interface TaskRowMin {
  id: string;
  delivery_date: string;
  driver_id: string;
  status: string;
}
interface StopRowMin {
  delivery_task_id: string;
  stop_id: string;
  status: string;
  on_time: boolean | null;
  exception_reason: string | null;
}

async function aggregateQuarter(quarter: string): Promise<QuarterlyKpi> {
  const admin = createSupabaseAdminClient();
  const { start, end } = quarterRange(quarter);

  const { data: tasks } = await admin
    .from("delivery_tasks")
    .select("id, delivery_date, driver_id, status")
    .gte("delivery_date", start)
    .lte("delivery_date", end)
    .returns<TaskRowMin[]>();
  const taskList = tasks ?? [];

  let stopList: StopRowMin[] = [];
  if (taskList.length > 0) {
    const { data: stops } = await admin
      .from("delivery_task_stops")
      .select("delivery_task_id, stop_id, status, on_time, exception_reason")
      .in("delivery_task_id", taskList.map((t) => t.id))
      .returns<StopRowMin[]>();
    stopList = stops ?? [];
  }

  const completedTasks = taskList.filter((t) => t.status === "completed").length;
  const completedStops = stopList.filter((s) => s.status === "completed").length;
  const onTime = stopList.filter((s) => s.on_time).length;
  const exceptions = stopList.filter(
    (s) => s.exception_reason || s.status === "failed"
  ).length;

  return {
    quarter,
    start_date: start,
    end_date: end,
    total_tasks: taskList.length,
    completed_tasks: completedTasks,
    total_stops: stopList.length,
    completed_stops: completedStops,
    on_time_stops: onTime,
    exception_stops: exceptions,
    completion_rate: stopList.length === 0 ? 0 : completedStops / stopList.length,
    on_time_rate: completedStops === 0 ? 0 : onTime / completedStops,
    unique_drivers: new Set(taskList.map((t) => t.driver_id)).size,
    unique_stores: new Set(stopList.map((s) => s.stop_id)).size
  };
}

async function monthlyTrend(quarter: string): Promise<MonthlyPoint[]> {
  const admin = createSupabaseAdminClient();
  const { start, end } = quarterRange(quarter);

  const { data: tasks } = await admin
    .from("delivery_tasks")
    .select("id, delivery_date")
    .gte("delivery_date", start)
    .lte("delivery_date", end)
    .returns<{ id: string; delivery_date: string }[]>();
  const taskList = tasks ?? [];
  if (taskList.length === 0) return [];

  const taskIds = taskList.map((t) => t.id);
  const taskDate = new Map(taskList.map((t) => [t.id, t.delivery_date]));

  const { data: stops } = await admin
    .from("delivery_task_stops")
    .select("delivery_task_id, status, on_time, exception_reason")
    .in("delivery_task_id", taskIds)
    .returns<StopRowMin[]>();
  const stopList = stops ?? [];

  const monthly = new Map<string, MonthlyPoint>();
  for (const s of stopList) {
    const date = taskDate.get(s.delivery_task_id);
    if (!date) continue;
    const ym = date.slice(0, 7);
    if (!monthly.has(ym)) monthly.set(ym, { ym, completed: 0, on_time: 0, exceptions: 0 });
    const p = monthly.get(ym)!;
    if (s.status === "completed") p.completed++;
    if (s.on_time) p.on_time++;
    if (s.exception_reason || s.status === "failed") p.exceptions++;
  }
  return Array.from(monthly.values()).sort((a, b) => a.ym.localeCompare(b.ym));
}

async function topDrivers(quarter: string, limit = 8): Promise<DriverRank[]> {
  const admin = createSupabaseAdminClient();
  const { start, end } = quarterRange(quarter);

  interface JoinedTask {
    id: string;
    driver_id: string;
    driver: { full_name: string; employee_code: string | null }
            | { full_name: string; employee_code: string | null }[]
            | null;
  }
  const { data: tasks } = await admin
    .from("delivery_tasks")
    .select("id, driver_id, driver:profiles(full_name, employee_code)")
    .gte("delivery_date", start)
    .lte("delivery_date", end)
    .returns<JoinedTask[]>();
  const taskList = tasks ?? [];
  if (taskList.length === 0) return [];

  const { data: stops } = await admin
    .from("delivery_task_stops")
    .select("delivery_task_id, status, on_time")
    .in("delivery_task_id", taskList.map((t) => t.id))
    .returns<{ delivery_task_id: string; status: string; on_time: boolean | null }[]>();
  const stopList = stops ?? [];

  const taskOwner = new Map(taskList.map((t) => [t.id, t]));
  const byDriver = new Map<string, {
    driver_id: string;
    driver_name: string;
    employee_code: string | null;
    task_ids: Set<string>;
    completed_stops: number;
    on_time_stops: number;
  }>();

  function pickFirst<T>(v: T | T[] | null | undefined): T | null {
    if (!v) return null;
    return Array.isArray(v) ? v[0] ?? null : v;
  }

  for (const s of stopList) {
    const t = taskOwner.get(s.delivery_task_id);
    if (!t) continue;
    if (!byDriver.has(t.driver_id)) {
      const d = pickFirst(t.driver);
      byDriver.set(t.driver_id, {
        driver_id: t.driver_id,
        driver_name: d?.full_name ?? "(未知)",
        employee_code: d?.employee_code ?? null,
        task_ids: new Set(),
        completed_stops: 0,
        on_time_stops: 0
      });
    }
    const agg = byDriver.get(t.driver_id)!;
    agg.task_ids.add(t.id);
    if (s.status === "completed") agg.completed_stops++;
    if (s.on_time) agg.on_time_stops++;
  }

  return Array.from(byDriver.values())
    .map((d) => ({
      driver_id: d.driver_id,
      driver_name: d.driver_name,
      employee_code: d.employee_code,
      task_count: d.task_ids.size,
      completed_stops: d.completed_stops,
      on_time_rate: d.completed_stops === 0 ? 0 : d.on_time_stops / d.completed_stops
    }))
    .sort((a, b) => b.completed_stops - a.completed_stops)
    .slice(0, limit);
}

async function problemStores(quarter: string, limit = 8): Promise<ProblemStore[]> {
  const admin = createSupabaseAdminClient();
  const { start, end } = quarterRange(quarter);

  const { data: tasks } = await admin
    .from("delivery_tasks")
    .select("id")
    .gte("delivery_date", start)
    .lte("delivery_date", end)
    .returns<{ id: string }[]>();
  if (!tasks || tasks.length === 0) return [];

  interface ProblemStopRow {
    stop_id: string;
    status: string;
    on_time: boolean | null;
    exception_reason: string | null;
    stop: { name: string; city: string | null; district: string | null }
          | { name: string; city: string | null; district: string | null }[]
          | null;
  }
  const { data: stops } = await admin
    .from("delivery_task_stops")
    .select("stop_id, status, on_time, exception_reason, stop:stops(name, city, district)")
    .in("delivery_task_id", tasks.map((t) => t.id))
    .returns<ProblemStopRow[]>();
  const stopList = stops ?? [];

  const byStop = new Map<string, ProblemStore>();
  for (const s of stopList) {
    const isException = !!s.exception_reason || s.status === "failed";
    const isLate = s.on_time === false;
    if (!isException && !isLate) continue;
    if (!byStop.has(s.stop_id)) {
      const m = Array.isArray(s.stop) ? s.stop[0] : s.stop;
      byStop.set(s.stop_id, {
        stop_id: s.stop_id,
        stop_name: m?.name ?? "(未知)",
        city: m?.city ?? null,
        district: m?.district ?? null,
        exception_count: 0,
        late_count: 0
      });
    }
    const agg = byStop.get(s.stop_id)!;
    if (isException) agg.exception_count++;
    if (isLate) agg.late_count++;
  }

  return Array.from(byStop.values())
    .sort((a, b) => (b.exception_count + b.late_count) - (a.exception_count + a.late_count))
    .slice(0, limit);
}

async function statusBreakdown(quarter: string): Promise<QuarterlyStatusBreakdown> {
  const admin = createSupabaseAdminClient();
  const { start, end } = quarterRange(quarter);

  const { data: tasks } = await admin
    .from("delivery_tasks")
    .select("id")
    .gte("delivery_date", start)
    .lte("delivery_date", end)
    .returns<{ id: string }[]>();
  const out: QuarterlyStatusBreakdown = {
    pending: 0, navigating: 0, arrived: 0,
    completed: 0, failed: 0, skipped: 0
  };
  if (!tasks || tasks.length === 0) return out;

  const { data: stops } = await admin
    .from("delivery_task_stops")
    .select("status")
    .in("delivery_task_id", tasks.map((t) => t.id))
    .returns<{ status: string }[]>();
  for (const s of stops ?? []) {
    if (s.status in out) {
      (out as unknown as Record<string, number>)[s.status] += 1;
    }
  }
  return out;
}

export async function getQuarterlyAnalysis(quarter: string): Promise<QuarterlyAnalysis> {
  const [current, previous, trend, drivers, stores, breakdown] = await Promise.all([
    aggregateQuarter(quarter),
    aggregateQuarter(prevQuarter(quarter)).catch(() => null),
    monthlyTrend(quarter),
    topDrivers(quarter),
    problemStores(quarter),
    statusBreakdown(quarter)
  ]);
  return {
    current,
    previous,
    monthly_trend: trend,
    top_drivers: drivers,
    problem_stores: stores,
    status_breakdown: breakdown
  };
}

export function defaultQuarter(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const q = Math.floor(m / 3) + 1;
  return `${y}Q${q}`;
}

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

/**
 * 準時率分桶 — 把 0..100% 切 5 段（每段 20%），統計落在每段的個數。
 * 用於「物流士準時率 donut」/「門市到貨準時率 donut」。
 * key 順序固定，做 chart 時 ordered iterate 即可。
 */
export interface OnTimeBuckets {
  /** 0~20% */
  b0_20: number;
  /** 20~40% */
  b20_40: number;
  /** 40~60% */
  b40_60: number;
  /** 60~80% */
  b60_80: number;
  /** 80~100% */
  b80_100: number;
  /** 全部都已派送 / 完成的個體總數（=各 bucket 加總） */
  total: number;
}

export interface QuarterlyAnalysis {
  current: QuarterlyKpi;
  previous: QuarterlyKpi | null;  // 上一季比較
  monthly_trend: MonthlyPoint[];
  top_drivers: DriverRank[];
  problem_stores: ProblemStore[];
  /** 季內所有站點的最終狀態分佈（給 donut 用） */
  status_breakdown: QuarterlyStatusBreakdown;
  /** 物流士準時率分桶（每位 driver 一個 on_time_rate，落到 5 個桶之一） */
  driver_on_time_buckets: OnTimeBuckets;
  /** 門市到貨準時率分桶（每家 store 一個 on_time_rate） */
  store_on_time_buckets: OnTimeBuckets;
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

  // 🔁 fallback：本季完全沒 delivery 紀錄 → 用「目前 published plan」的 route_stops
  //    把 total_stops / unique_drivers 補上去，讓季度頁不會全 0
  let plannedStops = stopList.length;
  let plannedDriverIds = new Set(taskList.map((t) => t.driver_id));
  let plannedStopIds = new Set(stopList.map((s) => s.stop_id));

  if (stopList.length === 0) {
    const { data: plan } = await admin
      .from("route_plans")
      .select("id, published_at")
      .eq("status", "published")
      .gte("published_at", `${start}T00:00:00Z`)
      .lte("published_at", `${end}T23:59:59Z`)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (plan) {
      const { data: assigns } = await admin
        .from("driver_route_assignments")
        .select("id, driver_id")
        .eq("route_plan_id", plan.id);
      const aIds = (assigns ?? []).map((a) => (a as { id: string }).id);
      const driverIds = (assigns ?? [])
        .map((a) => (a as { driver_id: string | null }).driver_id)
        .filter((x): x is string => !!x);
      plannedDriverIds = new Set(driverIds);
      if (aIds.length > 0) {
        const { data: rs } = await admin
          .from("route_stops")
          .select("stop_id")
          .in("driver_route_assignment_id", aIds);
        plannedStopIds = new Set(
          ((rs ?? []) as Array<{ stop_id: string }>).map((r) => r.stop_id)
        );
        plannedStops = (rs ?? []).length;
      }
    }
  }

  return {
    quarter,
    start_date: start,
    end_date: end,
    total_tasks: taskList.length,
    completed_tasks: completedTasks,
    total_stops: plannedStops,
    completed_stops: completedStops,
    on_time_stops: onTime,
    exception_stops: exceptions,
    completion_rate: plannedStops === 0 ? 0 : completedStops / plannedStops,
    on_time_rate: completedStops === 0 ? 0 : onTime / completedStops,
    unique_drivers: plannedDriverIds.size,
    unique_stores: plannedStopIds.size
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
    stop: { name: string; city: string | null; district: string | null; is_active: boolean }
          | { name: string; city: string | null; district: string | null; is_active: boolean }[]
          | null;
  }
  const { data: stops } = await admin
    .from("delivery_task_stops")
    .select(
      "stop_id, status, on_time, exception_reason, " +
        "stop:stops(name, city, district, is_active)"
    )
    .in("delivery_task_id", tasks.map((t) => t.id))
    .returns<ProblemStopRow[]>();
  const stopList = stops ?? [];

  const byStop = new Map<string, ProblemStore>();
  for (const s of stopList) {
    const isException = !!s.exception_reason || s.status === "failed";
    const isLate = s.on_time === false;
    if (!isException && !isLate) continue;
    const m = Array.isArray(s.stop) ? s.stop[0] : s.stop;
    // 只計入仍 active 的 stop — 老舊封存的 stop 不算「本季異常熱點」
    if (m && m.is_active === false) continue;
    if (!byStop.has(s.stop_id)) {
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

  if (tasks && tasks.length > 0) {
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
  }

  // 全 0 → fallback：用本季「最新 published plan」的 route_stops 當 pending
  const totalSoFar = Object.values(out).reduce((s, v) => s + v, 0);
  if (totalSoFar === 0) {
    const { data: plan } = await admin
      .from("route_plans")
      .select("id")
      .eq("status", "published")
      .gte("published_at", `${start}T00:00:00Z`)
      .lte("published_at", `${end}T23:59:59Z`)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (plan) {
      const { data: assigns } = await admin
        .from("driver_route_assignments")
        .select("id")
        .eq("route_plan_id", plan.id);
      const aIds = ((assigns ?? []) as Array<{ id: string }>).map((a) => a.id);
      if (aIds.length > 0) {
        const { count } = await admin
          .from("route_stops")
          .select("id", { count: "exact", head: true })
          .in("driver_route_assignment_id", aIds);
        out.pending = count ?? 0;
      }
    }
  }
  return out;
}

/**
 * 把一組 on_time_rate（0..1）丟進 5 個 bucket：[0,0.2)/[0.2,0.4)/[0.4,0.6)/[0.6,0.8)/[0.8,1]
 */
function bucketize(rates: number[]): OnTimeBuckets {
  const out: OnTimeBuckets = {
    b0_20: 0, b20_40: 0, b40_60: 0, b60_80: 0, b80_100: 0, total: 0
  };
  for (const r of rates) {
    if (!Number.isFinite(r)) continue;
    out.total++;
    if (r < 0.2)      out.b0_20++;
    else if (r < 0.4) out.b20_40++;
    else if (r < 0.6) out.b40_60++;
    else if (r < 0.8) out.b60_80++;
    else              out.b80_100++;
  }
  return out;
}

/**
 * 計算本季「物流士準時率」與「門市到貨準時率」分佈。
 *  - 物流士準時率 = sum(on_time) / sum(completed)  per driver
 *  - 門市準時率   = sum(on_time) / sum(completed)  per stop
 *  - 只計入有「至少一次 completed」的個體（avoid 0/0 噪音）
 */
async function onTimeDistribution(quarter: string): Promise<{
  driver: OnTimeBuckets;
  store:  OnTimeBuckets;
}> {
  const admin = createSupabaseAdminClient();
  const { start, end } = quarterRange(quarter);

  // 本季 tasks
  const { data: tasks } = await admin
    .from("delivery_tasks")
    .select("id, driver_id")
    .gte("delivery_date", start)
    .lte("delivery_date", end)
    .returns<{ id: string; driver_id: string }[]>();
  if (!tasks || tasks.length === 0) {
    const empty: OnTimeBuckets = { b0_20: 0, b20_40: 0, b40_60: 0, b60_80: 0, b80_100: 0, total: 0 };
    return { driver: empty, store: empty };
  }
  const taskDriver = new Map(tasks.map((t) => [t.id, t.driver_id]));

  const { data: stops } = await admin
    .from("delivery_task_stops")
    .select("delivery_task_id, stop_id, status, on_time")
    .in("delivery_task_id", tasks.map((t) => t.id))
    .returns<{
      delivery_task_id: string; stop_id: string;
      status: string; on_time: boolean | null;
    }[]>();

  // 累計 per-driver / per-store
  const drvAgg = new Map<string, { completed: number; on_time: number }>();
  const stpAgg = new Map<string, { completed: number; on_time: number }>();

  for (const s of stops ?? []) {
    if (s.status !== "completed") continue;
    const did = taskDriver.get(s.delivery_task_id);
    if (did) {
      const r = drvAgg.get(did) ?? { completed: 0, on_time: 0 };
      r.completed++;
      if (s.on_time === true) r.on_time++;
      drvAgg.set(did, r);
    }
    {
      const r = stpAgg.get(s.stop_id) ?? { completed: 0, on_time: 0 };
      r.completed++;
      if (s.on_time === true) r.on_time++;
      stpAgg.set(s.stop_id, r);
    }
  }

  const drvRates = [...drvAgg.values()]
    .filter((r) => r.completed > 0)
    .map((r) => r.on_time / r.completed);
  const stpRates = [...stpAgg.values()]
    .filter((r) => r.completed > 0)
    .map((r) => r.on_time / r.completed);

  return { driver: bucketize(drvRates), store: bucketize(stpRates) };
}

export async function getQuarterlyAnalysis(quarter: string): Promise<QuarterlyAnalysis> {
  const [current, previous, trend, drivers, stores, breakdown, otd] = await Promise.all([
    aggregateQuarter(quarter),
    aggregateQuarter(prevQuarter(quarter)).catch(() => null),
    monthlyTrend(quarter),
    topDrivers(quarter),
    problemStores(quarter),
    statusBreakdown(quarter),
    onTimeDistribution(quarter)
  ]);
  return {
    current,
    previous,
    monthly_trend: trend,
    top_drivers: drivers,
    problem_stores: stores,
    status_breakdown: breakdown,
    driver_on_time_buckets: otd.driver,
    store_on_time_buckets:  otd.store
  };
}

export function defaultQuarter(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const q = Math.floor(m / 3) + 1;
  return `${y}Q${q}`;
}

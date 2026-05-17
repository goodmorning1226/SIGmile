import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface HourlyPoint {
  hour: number;        // 0–23
  completed: number;   // 此小時內完成的站數
  cumulative: number;  // 截至此小時的累計完成
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

function todayInTaipei(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.APP_TIMEZONE ?? "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
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
}

function pickFirst<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export async function getDashboardCharts(): Promise<DashboardCharts> {
  const supabase = await createSupabaseServerClient();
  const date = todayInTaipei();

  const { data: tasks } = await supabase
    .from("delivery_tasks")
    .select("id, driver_id, status, driver:profiles(full_name, employee_code)")
    .eq("delivery_date", date)
    .returns<TaskRow[]>();

  const taskList = tasks ?? [];

  if (taskList.length === 0) {
    return {
      hourly: emptyHourly(),
      drivers: [],
      status: { pending: 0, navigating: 0, arrived: 0, completed: 0, failed: 0, skipped: 0 },
      date
    };
  }

  const taskIds = taskList.map((t) => t.id);
  const { data: stops } = await supabase
    .from("delivery_task_stops")
    .select("delivery_task_id, status, completed_at, on_time")
    .in("delivery_task_id", taskIds)
    .returns<StopRow[]>();

  const stopList = stops ?? [];

  // ----- driver ranking -----
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

  // ----- status breakdown -----
  const status: StatusBreakdown = {
    pending: 0, navigating: 0, arrived: 0,
    completed: 0, failed: 0, skipped: 0
  };
  for (const s of stopList) {
    if (s.status in status) {
      (status as any)[s.status] += 1;
    }
  }

  // ----- hourly progress -----
  const tz = process.env.APP_TIMEZONE ?? "Asia/Taipei";
  const hourCount = new Array<number>(24).fill(0);
  for (const s of stopList) {
    if (s.status !== "completed" || !s.completed_at) continue;
    const dt = new Date(s.completed_at);
    // 取台北時區的小時
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, hour: "2-digit", hour12: false
    });
    const h = parseInt(fmt.format(dt), 10);
    if (!Number.isNaN(h)) hourCount[h] += 1;
  }
  // 累計：只顯示 06:00–22:00
  const hourly: HourlyPoint[] = [];
  let cum = 0;
  for (let h = 6; h <= 22; h++) {
    cum += hourCount[h];
    hourly.push({ hour: h, completed: hourCount[h], cumulative: cum });
  }

  return { hourly, drivers, status, date };
}

function emptyHourly(): HourlyPoint[] {
  const out: HourlyPoint[] = [];
  for (let h = 6; h <= 22; h++) {
    out.push({ hour: h, completed: 0, cumulative: 0 });
  }
  return out;
}

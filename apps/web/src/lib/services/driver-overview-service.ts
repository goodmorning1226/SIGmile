import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * task_status:
 *   - "idle"          → 物流士今天沒被派任務（profile 存在 + active）
 *   - "pending"       → 已派任務但尚未開始
 *   - "in_progress"   → 配送中
 *   - "completed"     → 全部配完
 *   - "cancelled"     → 任務取消
 */
export interface DriverOverviewRow {
  /** 沒任務的 driver 為 null */
  task_id: string | null;
  driver_id: string;
  driver_name: string;
  employee_code: string | null;
  route_name: string | null;
  task_status: string;
  current_stop_id: string | null;
  current_stop_name: string | null;
  next_stop_name: string | null;
  completed: number;
  total: number;
  exceptions: number;
}

interface TaskRow {
  id: string;
  driver_id: string;
  status: string;
  current_stop_id: string | null;
  driver: { full_name: string; employee_code: string | null } | { full_name: string; employee_code: string | null }[] | null;
  assignment: { route_name: string } | { route_name: string }[] | null;
}
interface StopRow {
  delivery_task_id: string;
  stop_id: string;
  stop_order: number;
  status: string;
  stop: { name: string } | { name: string }[] | null;
}

function pickFirst<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function todayInTaipei() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.APP_TIMEZONE ?? "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

export async function getDriversOverview(date?: string): Promise<DriverOverviewRow[]> {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  const target = date ?? todayInTaipei();

  interface ProfileRow {
    id: string;
    full_name: string;
    employee_code: string | null;
  }
  // ★ profiles + tasks 同時下
  const [profilesRes, tasksRes] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, employee_code")
      .eq("role", "driver")
      .eq("is_active", true)
      .order("employee_code", { ascending: true })
      .returns<ProfileRow[]>(),
    supabase
      .from("delivery_tasks")
      .select(
        "id, driver_id, status, current_stop_id, " +
          "driver:profiles(full_name, employee_code), " +
          "assignment:driver_route_assignments(route_name)"
      )
      .eq("delivery_date", target)
      .returns<TaskRow[]>()
  ]);
  const profiles = profilesRes.data ?? [];
  if (tasksRes.error) throw tasksRes.error;
  const tasks = tasksRes.data;

  const taskList = tasks ?? [];
  const tasksByDriver = new Map<string, TaskRow>();
  for (const t of taskList) tasksByDriver.set(t.driver_id, t);

  // 3. 今日所有 task 的 stops（一次抓）
  let stops: StopRow[] = [];
  if (taskList.length > 0) {
    const taskIds = taskList.map((t) => t.id);
    const { data: stopsRaw, error: sErr } = await supabase
      .from("delivery_task_stops")
      .select("delivery_task_id, stop_id, stop_order, status, stop:stops(name)")
      .in("delivery_task_id", taskIds)
      .order("stop_order", { ascending: true })
      .returns<StopRow[]>();
    if (sErr) throw sErr;
    stops = stopsRaw ?? [];
  }

  // 4. 對每位 active driver 組 row（不論今天有沒有任務）
  const rows: DriverOverviewRow[] = profiles.map((p) => {
    const t = tasksByDriver.get(p.id);
    if (!t) {
      return {
        task_id: null,
        driver_id: p.id,
        driver_name: p.full_name,
        employee_code: p.employee_code,
        route_name: null,
        task_status: "idle",
        current_stop_id: null,
        current_stop_name: null,
        next_stop_name: null,
        completed: 0,
        total: 0,
        exceptions: 0
      };
    }
    const ownStops = stops.filter((s) => s.delivery_task_id === t.id);
    const completed = ownStops.filter((s) => s.status === "completed").length;
    const exceptions = ownStops.filter((s) => s.status === "failed").length;
    const currentStop = ownStops.find((s) => s.stop_id === t.current_stop_id);
    const currentOrder = currentStop?.stop_order ?? -1;
    const nextStop = ownStops.find(
      (s) =>
        s.stop_order > currentOrder &&
        (s.status === "pending" || s.status === "navigating" || s.status === "arrived")
    );
    const assignment = pickFirst(t.assignment);
    return {
      task_id: t.id,
      driver_id: t.driver_id,
      driver_name: p.full_name,
      employee_code: p.employee_code,
      route_name: assignment?.route_name ?? null,
      task_status: t.status,
      current_stop_id: t.current_stop_id,
      current_stop_name: pickFirst(currentStop?.stop)?.name ?? null,
      next_stop_name: pickFirst(nextStop?.stop)?.name ?? null,
      completed,
      total: ownStops.length,
      exceptions
    };
  });

  return rows.sort((a, b) => (a.employee_code ?? "").localeCompare(b.employee_code ?? ""));
}

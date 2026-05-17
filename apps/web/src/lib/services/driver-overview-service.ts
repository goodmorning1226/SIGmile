import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface DriverOverviewRow {
  task_id: string;
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
  const target = date ?? todayInTaipei();

  const { data: tasks, error: tErr } = await supabase
    .from("delivery_tasks")
    .select(
      "id, driver_id, status, current_stop_id, " +
        "driver:profiles(full_name, employee_code), " +
        "assignment:driver_route_assignments(route_name)"
    )
    .eq("delivery_date", target)
    .returns<TaskRow[]>();
  if (tErr) throw tErr;
  if (!tasks || tasks.length === 0) return [];

  const taskIds = tasks.map((t) => t.id);
  const { data: stops, error: sErr } = await supabase
    .from("delivery_task_stops")
    .select("delivery_task_id, stop_id, stop_order, status, stop:stops(name)")
    .in("delivery_task_id", taskIds)
    .order("stop_order", { ascending: true })
    .returns<StopRow[]>();
  if (sErr) throw sErr;

  return tasks.map((t) => {
    const ownStops = (stops ?? []).filter((s) => s.delivery_task_id === t.id);
    const completed = ownStops.filter((s) => s.status === "completed").length;
    const exceptions = ownStops.filter((s) => s.status === "failed").length;

    const currentStop = ownStops.find((s) => s.stop_id === t.current_stop_id);
    const currentOrder = currentStop?.stop_order ?? -1;
    const nextStop = ownStops.find(
      (s) =>
        s.stop_order > currentOrder &&
        (s.status === "pending" || s.status === "navigating" || s.status === "arrived")
    );

    const driver = pickFirst(t.driver);
    const assignment = pickFirst(t.assignment);

    return {
      task_id: t.id,
      driver_id: t.driver_id,
      driver_name: driver?.full_name ?? "(未知)",
      employee_code: driver?.employee_code ?? null,
      route_name: assignment?.route_name ?? null,
      task_status: t.status,
      current_stop_id: t.current_stop_id,
      current_stop_name: pickFirst(currentStop?.stop)?.name ?? null,
      next_stop_name: pickFirst(nextStop?.stop)?.name ?? null,
      completed,
      total: ownStops.length,
      exceptions
    };
  }).sort((a, b) => (a.employee_code ?? "").localeCompare(b.employee_code ?? ""));
}

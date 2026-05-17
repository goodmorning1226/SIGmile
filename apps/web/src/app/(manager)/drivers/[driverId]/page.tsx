import { ArrowLeft, Clock, MapPin } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge } from "@/components/status/StatusBadge";
import { MapPlaceholder } from "@/components/map/MapPlaceholder";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ReorderTable } from "./ReorderTable";

export const dynamic = "force-dynamic";

interface PageProps { params: Promise<{ driverId: string }>; }

interface TaskRow {
  id: string;
  delivery_date: string;
  status: string;
  current_stop_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  driver: { full_name: string; employee_code: string | null } | { full_name: string; employee_code: string | null }[] | null;
  assignment: { route_name: string } | { route_name: string }[] | null;
}
interface StopRow {
  id: string;
  stop_id: string;
  stop_order: number;
  status: string;
  planned_arrival_at: string | null;
  actual_arrival_at: string | null;
  completed_at: string | null;
  on_time: boolean | null;
  exception_reason: string | null;
  stop: { name: string; address: string; lat: number | null; lng: number | null } | { name: string; address: string; lat: number | null; lng: number | null }[] | null;
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

export default async function DriverDetailPage({ params }: PageProps) {
  const { driverId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: task } = await supabase
    .from("delivery_tasks")
    .select(
      "id, delivery_date, status, current_stop_id, started_at, completed_at, " +
        "driver:profiles(full_name, employee_code), " +
        "assignment:driver_route_assignments(route_name)"
    )
    .eq("driver_id", driverId)
    .eq("delivery_date", todayInTaipei())
    .maybeSingle<TaskRow>();

  if (!task) notFound();

  const { data: stopsData } = await supabase
    .from("delivery_task_stops")
    .select(
      "id, stop_id, stop_order, status, planned_arrival_at, actual_arrival_at, " +
        "completed_at, on_time, exception_reason, " +
        "stop:stops(name, address, lat, lng)"
    )
    .eq("delivery_task_id", task.id)
    .order("stop_order", { ascending: true })
    .returns<StopRow[]>();

  const stops = stopsData ?? [];
  const driver = pickFirst(task.driver);
  const assignment = pickFirst(task.assignment);
  const completed = stops.filter((s) => s.status === "completed").length;
  const total = stops.length;

  const pins = stops.map((s) => {
    const stop = pickFirst(s.stop);
    return { lat: stop?.lat ?? null, lng: stop?.lng ?? null, label: `${s.stop_order}. ${stop?.name ?? "?"}` };
  });

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/drivers" className="inline-flex items-center gap-1 hover:text-brand-600">
            <ArrowLeft className="size-3.5" /> 返回物流士列表
          </Link>
        }
        title={`${driver?.full_name ?? "(未知)"} 的今日路線`}
        description={`${driver?.employee_code ?? "—"} · ${assignment?.route_name ?? "—"} · ${task.delivery_date}`}
        actions={<StatusBadge status={task.status as any} />}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        {/* 左：地圖（較大） + 任務 meta */}
        <div className="xl:col-span-3 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>位置與路線</CardTitle>
                  <CardDescription>未來會接 Google Maps，目前顯示佔位</CardDescription>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-semibold tabular-nums text-brand-600">
                    {total === 0 ? 0 : Math.round((completed / total) * 100)}%
                  </div>
                  <div className="text-xs text-slate-500">
                    完成 {completed} / {total} 站
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <MapPlaceholder pins={pins} height={420} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>任務資訊</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <MetaRow label="日期" value={task.delivery_date} />
              <MetaRow label="路線" value={assignment?.route_name ?? "—"} />
              <MetaRow label="員工編號" value={driver?.employee_code ?? "—"} />
              <MetaRow label="開始時間" value={task.started_at ? new Date(task.started_at).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }) : "—"} />
              <MetaRow label="完成時間" value={task.completed_at ? new Date(task.completed_at).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }) : "—"} />
            </CardContent>
          </Card>
        </div>

        {/* 右：停靠點時間軸 + reorder */}
        <div className="xl:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>停靠點時間軸</CardTitle>
              <CardDescription>可調整未完成站的順序</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ReorderTable
                taskId={task.id}
                driverId={driverId}
                stops={stops.map((s) => ({
                  id: s.id,
                  stop_order: s.stop_order,
                  status: s.status,
                  planned_arrival_at: s.planned_arrival_at,
                  actual_arrival_at: s.actual_arrival_at,
                  completed_at: s.completed_at,
                  on_time: s.on_time,
                  exception_reason: s.exception_reason,
                  stop_name: pickFirst(s.stop)?.name ?? "(未命名)",
                  stop_address: pickFirst(s.stop)?.address ?? ""
                }))}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-1.5 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800 tabular-nums">{value}</span>
    </div>
  );
}

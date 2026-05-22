import { ArrowLeft, Inbox } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge } from "@/components/status/StatusBadge";
import { RouteMap } from "@/components/map/RouteMap";
import { InteractiveRouteMap } from "@/components/map/InteractiveRouteMap";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getRouteMapData } from "@/lib/services/route-map-service";
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
  const admin = createSupabaseAdminClient();

  // ★ profile + task 同時抓
  const [profileRes, taskRes] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, employee_code, shift, vehicle_capacity, temperature_capability")
      .eq("id", driverId)
      .maybeSingle<{
        id: string; full_name: string; employee_code: string | null;
        shift: string | null; vehicle_capacity: number | null;
        temperature_capability: string | null;
      }>(),
    supabase
      .from("delivery_tasks")
      .select(
        "id, delivery_date, status, current_stop_id, started_at, completed_at, " +
          "driver:profiles(full_name, employee_code), " +
          "assignment:driver_route_assignments(route_name)"
      )
      .eq("driver_id", driverId)
      .eq("delivery_date", todayInTaipei())
      .maybeSingle<TaskRow>()
  ]);

  const profile = profileRes.data;
  const task = taskRes.data;

  if (!profile) notFound();

  // 沒任務：顯示「今日無任務」頁，不要 404
  if (!task) {
    return (
      <>
        <PageHeader
          breadcrumb={
            <Link href="/drivers" className="inline-flex items-center gap-1 hover:text-brand-600">
              <ArrowLeft className="size-3.5" /> 返回物流士列表
            </Link>
          }
          title={`${profile.full_name} · 今日無任務`}
          description={`${profile.employee_code ?? "—"} · 班別 ${profile.shift ?? "—"} · 容量 ${profile.vehicle_capacity ?? "—"} 箱`}
          actions={<StatusBadge status={"idle" as any} />}
        />
        <Card>
          <CardContent className="flex items-center gap-3 py-12 text-sm text-slate-500">
            <Inbox className="size-5 text-slate-400" />
            <div>
              這位物流士今天沒有被分派任務。
              到「發布新路線」採用 / 發布一個包含此物流士的路線後就會出現。
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

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

  // 撈 DC 座標（取此 driver 所屬的 distribution_center）— 一次 join 完
  const { data: dcJoin } = await admin
    .from("profiles")
    .select("distribution_center:distribution_centers(lat, lng)")
    .eq("id", driverId)
    .maybeSingle<{
      distribution_center:
        | { lat: number | null; lng: number | null }
        | { lat: number | null; lng: number | null }[]
        | null;
    }>();
  const dcRow = pickFirst(dcJoin?.distribution_center);
  const depot =
    dcRow?.lat != null && dcRow?.lng != null
      ? { lat: dcRow.lat, lng: dcRow.lng }
      : null;

  const mapStops = stops
    .map((s) => {
      const st = pickFirst(s.stop);
      return st?.lat != null && st?.lng != null
        ? {
            lat: st.lat, lng: st.lng,
            name: st.name,
            order: s.stop_order,
            status: s.status
          }
        : null;
    })
    .filter((x): x is { lat: number; lng: number; name: string; order: number; status: string } => x !== null);

  // 同時 server-side 抓 TomTom 路線 polyline + Static Map URL
  const mapData = await getRouteMapData({ depot, stops: mapStops });
  // 把 TOMTOM_API_KEY 帶到 client side 給可互動的 TomTom Maps SDK 用
  // （key 會出現在 HTML，請在 TomTom Dashboard 限定網域）
  const tomtomKey = process.env.TOMTOM_API_KEY ?? null;

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
                  <CardDescription>
                    {depot
                      ? "DC + 所有停靠點 · TomTom 計算的真實道路路線"
                      : "⚠️ 此物流士尚未指定物流中心（distribution_center_id），地圖不含 DC"}
                  </CardDescription>
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
              {mapData ? (
                tomtomKey ? (
                  <InteractiveRouteMap data={mapData} apiKey={tomtomKey} height={480} />
                ) : (
                  // 無 API key 時 fallback 到靜態圖
                  <RouteMap data={mapData} />
                )
              ) : (
                <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">
                  尚無有效座標可顯示地圖
                </div>
              )}
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

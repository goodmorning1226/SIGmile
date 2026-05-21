import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * 「停靠點分群」資料模型 helper。
 *
 * 一個 route_plan 可以有：
 *   - 0..N 個 `driver_clusters`
 *   - 每個 cluster 透過 `route_stops.cluster_id` 對應一群 stops（可橫跨 trip_index）
 *
 * 流程：
 *   1. OR 跑完 → 建立一批 clusters + 把 route_stops.cluster_id 填好
 *   2. 主管在「停靠點分群」頁微調（改名、合併、拆分、調順序、跨群移動）
 *   3. 在「物流士分配」頁把 cluster 指派給 driver（cluster.assigned_driver_id）
 *   4. 發布時：把 cluster.assigned_driver_id 寫進 driver_route_assignments.driver_id
 */

export interface ClusterStop {
  route_stop_id: string;
  stop_id: string;
  stop_order: number;
  trip_index: number;
  estimated_arrival_time: string | null; // 'HH:MM:SS'
  estimated_service_minutes: number | null;
  stop_name: string;
  stop_address: string;
  stop_city: string | null;
  stop_district: string | null;
  stop_volume: number | null;       // avg_delivery_volume
  stop_shift: string | null;
  stop_temperature: string | null;
}

export interface ClusterRow {
  id: string;
  route_plan_id: string;
  cluster_name: string;
  sequence: number;
  estimated_total_minutes: number | null;
  estimated_total_distance_meters: number | null;
  estimated_total_volume: number | null;
  assigned_driver_id: string | null;
  required_shift: string | null;
  required_temperature: string | null;
  stops: ClusterStop[];
}

export interface PlanForEdit {
  id: string;
  planning_period_id: string;
  version: number;
  status: string;           // draft / published / archived
  source: string;
  notes: string | null;
  clusters: ClusterRow[];
  unclustered_stops: ClusterStop[]; // route_stops 沒被歸到任何 cluster
}

interface RawRouteStop {
  id: string;
  stop_id: string;
  stop_order: number;
  trip_index: number;
  estimated_arrival_time: string | null;
  estimated_service_minutes: number | null;
  cluster_id: string | null;
  stop: { name: string; address: string; city: string | null;
          district: string | null; avg_delivery_volume: number | null;
          shift: string | null; temperature_type: string | null }
       | { name: string; address: string; city: string | null;
           district: string | null; avg_delivery_volume: number | null;
           shift: string | null; temperature_type: string | null }[]
       | null;
}

function pickFirst<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function mapStop(r: RawRouteStop): ClusterStop {
  const s = pickFirst(r.stop);
  return {
    route_stop_id: r.id,
    stop_id: r.stop_id,
    stop_order: r.stop_order,
    trip_index: r.trip_index ?? 1,
    estimated_arrival_time: r.estimated_arrival_time,
    estimated_service_minutes: r.estimated_service_minutes,
    stop_name: s?.name ?? "(未命名)",
    stop_address: s?.address ?? "",
    stop_city: s?.city ?? null,
    stop_district: s?.district ?? null,
    stop_volume: s?.avg_delivery_volume ?? null,
    stop_shift: s?.shift ?? null,
    stop_temperature: s?.temperature_type ?? null
  };
}

/** 取 plan + 它底下所有 clusters + 每個 cluster 裡的 stops（依 stop_order） */
export async function getPlanForEdit(planId: string): Promise<PlanForEdit | null> {
  const admin = createSupabaseAdminClient();

  interface RawCluster {
    id: string;
    route_plan_id: string;
    cluster_name: string;
    sequence: number;
    estimated_total_minutes: number | null;
    estimated_total_distance_meters: number | null;
    estimated_total_volume: number | null;
    assigned_driver_id: string | null;
    required_shift: string | null;
    required_temperature: string | null;
  }

  // ★ 三個 query 同時下：plan info、clusters、DRA IDs。
  //   原本是 sequential (plan → clusters → dra → route_stops)，現在前 3 個 parallel。
  const [planRes, clustersRes, draRes] = await Promise.all([
    admin
      .from("route_plans")
      .select("id, planning_period_id, version, status, source, notes")
      .eq("id", planId)
      .maybeSingle(),
    admin
      .from("driver_clusters")
      .select(
        "id, route_plan_id, cluster_name, sequence, " +
          "estimated_total_minutes, estimated_total_distance_meters, " +
          "estimated_total_volume, assigned_driver_id, " +
          "required_shift, required_temperature"
      )
      .eq("route_plan_id", planId)
      .order("sequence", { ascending: true })
      .returns<RawCluster[]>(),
    admin
      .from("driver_route_assignments")
      .select("id")
      .eq("route_plan_id", planId)
      .returns<{ id: string }[]>()
  ]);

  const plan = planRes.data;
  if (!plan) return null;
  const clusters = clustersRes.data;
  const draRows = draRes.data;

  const clusterById = new Map<string, ClusterRow>();
  for (const c of clusters ?? []) {
    clusterById.set(c.id, { ...c, stops: [] });
  }

  const draIds = (draRows ?? []).map((d) => d.id);
  // route_stops 必須等 DRA IDs 出來才能 IN 查
  const { data: routeStops } = draIds.length === 0
    ? { data: [] as RawRouteStop[] }
    : await admin
        .from("route_stops")
        .select(
          "id, stop_id, stop_order, trip_index, estimated_arrival_time, " +
            "estimated_service_minutes, cluster_id, " +
            "stop:stops(name, address, city, district, avg_delivery_volume, shift, temperature_type)"
        )
        .in("driver_route_assignment_id", draIds)
        .order("stop_order", { ascending: true })
        .returns<RawRouteStop[]>();

  const unclustered: ClusterStop[] = [];
  for (const r of routeStops ?? []) {
    const cs = mapStop(r);
    if (r.cluster_id && clusterById.has(r.cluster_id)) {
      clusterById.get(r.cluster_id)!.stops.push(cs);
    } else {
      unclustered.push(cs);
    }
  }

  return {
    id: plan.id,
    planning_period_id: plan.planning_period_id,
    version: plan.version,
    status: plan.status,
    source: plan.source,
    notes: plan.notes,
    clusters: Array.from(clusterById.values()),
    unclustered_stops: unclustered
  };
}

/** 列出某 period 下的所有 draft / published plans（給選單用） */
export async function listEditablePlans(periodId: string): Promise<Array<{
  id: string; version: number; status: string; source: string; notes: string | null;
}>> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("route_plans")
    .select("id, version, status, source, notes")
    .eq("planning_period_id", periodId)
    .in("status", ["draft", "published"])
    .order("version", { ascending: false });
  return (data ?? []) as Array<{
    id: string; version: number; status: string; source: string; notes: string | null;
  }>;
}

/** 拿 active period（沒就拿最新） */
export async function getActivePeriod(): Promise<{
  id: string; code: string; name: string; status: string;
} | null> {
  const admin = createSupabaseAdminClient();
  const { data: periods } = await admin
    .from("planning_periods")
    .select("id, code, name, status")
    .order("start_date", { ascending: false });
  if (!periods || periods.length === 0) return null;
  const arr = periods as Array<{ id: string; code: string; name: string; status: string }>;
  return arr.find((p) => p.status === "active") ?? arr[0];
}

import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { OrOutputPlanV2, ShiftType, TemperatureType } from "@/types/domain";

/**
 * OR 規劃服務（MTVRP, multi-trip vehicle routing）。
 *
 * MVP 採 mock：依 shift / temperature 分組 → 每組依車輛容量切 cluster → 容量超過就拆第 2 趟。
 *
 * ★ 未來接 Python OR engine 的點 ★
 *   - 把 `runMockPlanningJob` 換成 `runPythonOrJob`：呼叫 Supabase Edge Function
 *     `/functions/v1/or-solver`（或自架 service），把 input_parameters + stops + drivers
 *     全部送過去，等回傳一份 `OrOutputPlanV2` JSONB 寫回 `or_planning_jobs.output_plan`。
 *   - `convertOutputToRoutePlan` 完全 schema-driven：只要回傳符合 `OrOutputPlanV2` 即相容。
 */

export interface CreatePlanningJobInput {
  planning_period_id: string;
  requested_by: string | null;
  input_parameters: Record<string, unknown>;
  weights?: Record<string, unknown>;
}

export interface IORPlanningService {
  createPlanningJob(input: CreatePlanningJobInput): Promise<{ jobId: string }>;
  runMockPlanningJob(jobId: string): Promise<{ output_plan: OrOutputPlanV2 }>;
  convertOutputToRoutePlan(jobId: string, createdBy: string | null): Promise<{ routePlanId: string }>;
}

interface StopRow {
  id: string;
  default_service_minutes: number;
  avg_delivery_volume: number | null;
  shift: string | null;
  temperature_type: string | null;
  lat: number | null;
  lng: number | null;
  city: string | null;
  district: string | null;
}

interface DriverRow {
  id: string;
  full_name: string;
  shift: string | null;
  vehicle_capacity: number | null;
  temperature_capability: string | null;
}

export class MockORPlanningService implements IORPlanningService {
  async createPlanningJob(input: CreatePlanningJobInput) {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("or_planning_jobs")
      .insert({
        planning_period_id: input.planning_period_id,
        requested_by: input.requested_by,
        input_parameters: input.input_parameters,
        weights: input.weights ?? {},
        status: "pending"
      })
      .select("id")
      .single();
    if (error) throw error;
    return { jobId: data.id as string };
  }

  async runMockPlanningJob(jobId: string) {
    const admin = createSupabaseAdminClient();

    const { data: job, error: jobErr } = await admin
      .from("or_planning_jobs")
      .select("id, planning_period_id, input_parameters")
      .eq("id", jobId)
      .single();
    if (jobErr || !job) throw jobErr ?? new Error("OR job not found");

    await admin
      .from("or_planning_jobs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", jobId);

    const { data: period } = await admin
      .from("planning_periods")
      .select("id, distribution_center_id")
      .eq("id", job.planning_period_id)
      .single();

    const { data: driversRaw } = await admin
      .from("profiles")
      .select("id, full_name, shift, vehicle_capacity, temperature_capability")
      .eq("role", "driver")
      .eq("is_active", true)
      .eq("distribution_center_id", period?.distribution_center_id ?? null)
      .returns<DriverRow[]>();

    const { data: stopsRaw } = await admin
      .from("stops")
      .select(
        "id, default_service_minutes, avg_delivery_volume, " +
          "shift, temperature_type, lat, lng, city, district"
      )
      .eq("is_active", true)
      .returns<StopRow[]>();

    const drivers = driversRaw ?? [];
    const stops   = stopsRaw ?? [];

    // 預設容量（input_parameters.defaults.vehicle_capacity_boxes 沒給就用 60）
    const params = (job.input_parameters ?? {}) as Record<string, any>;
    const defaultCapacity: number = params?.defaults?.vehicle_capacity_boxes ?? 60;
    const defaultVolume:   number = params?.defaults?.service_minutes_default ? 10 : 10;

    // ──────────────────────────────────────────────────────────
    // 分群策略（MOCK）
    //   1. 按 shift × city（沒 city 用 district fallback） bucket
    //   2. 每個 bucket 內依 driver 數 round-robin 切 cluster
    //   3. 每個 cluster 內依容量上限拆 trip（trip 1, trip 2）
    //   4. cluster.suggested_driver_id 用「相同 shift + 容量夠」的 driver
    // ──────────────────────────────────────────────────────────
    type Bucket = { key: string; shift: ShiftType | undefined; stops: StopRow[] };
    const buckets = new Map<string, Bucket>();
    for (const s of stops) {
      const sh = (s.shift as ShiftType | null) ?? undefined;
      const area = s.city ?? s.district ?? "其他區域";
      const key = `${sh ?? "any"}|${area}`;
      if (!buckets.has(key)) {
        buckets.set(key, { key, shift: sh, stops: [] });
      }
      buckets.get(key)!.stops.push(s);
    }

    let clusterSeq = 1;
    const clusterDocs: OrOutputPlanV2["clusters"] = [];

    for (const bucket of buckets.values()) {
      // 估計這個 bucket 要幾組
      const totalVol = bucket.stops.reduce((sum, s) => sum + (s.avg_delivery_volume ?? defaultVolume), 0);
      // 一台車 (capacity * 2 trips) 能載多少 → 估需要幾位 driver
      const perDriverCap = defaultCapacity * 2;
      const driversNeeded = Math.max(1, Math.ceil(totalVol / perDriverCap));

      // 把 stops 平均切成 driversNeeded 份
      const clustersInBucket: StopRow[][] = Array.from({ length: driversNeeded }, () => []);
      bucket.stops.forEach((s, i) => clustersInBucket[i % driversNeeded].push(s));

      const eligibleDrivers = drivers.filter(
        (d) => !bucket.shift || !d.shift || d.shift === bucket.shift
      );

      for (let ci = 0; ci < clustersInBucket.length; ci++) {
        const clusterStops = clustersInBucket[ci];
        if (clusterStops.length === 0) continue;

        // 容量分趟
        const cap = defaultCapacity;
        const trip1: StopRow[] = [];
        const trip2: StopRow[] = [];
        let tripVol = 0;
        for (const s of clusterStops) {
          const v = s.avg_delivery_volume ?? defaultVolume;
          if (trip2.length === 0 && tripVol + v <= cap) {
            trip1.push(s);
            tripVol += v;
          } else {
            trip2.push(s);
          }
        }

        // 估計時間（mock：每站平均行車 10 分鐘 + service）
        const estimateTrip = (arr: StopRow[]) => {
          let total = 0;
          for (const s of arr) total += 10 + (s.default_service_minutes ?? 10);
          return total;
        };
        const tripMins = estimateTrip(trip1) + estimateTrip(trip2);
        const totalDistance = clusterStops.length * 1500;
        const clusterVolume = clusterStops.reduce(
          (sum, s) => sum + (s.avg_delivery_volume ?? defaultVolume), 0
        );

        const suggestedDriver = eligibleDrivers[ci % Math.max(1, eligibleDrivers.length)]?.id ?? null;

        const tripsArr: OrOutputPlanV2["clusters"][number]["trips"] = [];
        let cursorMin = 8 * 60 + 30; // 08:30 起
        if (trip1.length > 0) {
          tripsArr.push({
            trip_index: 1,
            stops: trip1.map((s, k) => {
              const arrival = formatHM(cursorMin);
              cursorMin += 10 + (s.default_service_minutes ?? 10);
              return {
                stop_id: s.id,
                stop_order: k + 1,
                estimated_arrival_time: arrival,
                estimated_service_minutes: s.default_service_minutes ?? 10,
                estimated_volume: s.avg_delivery_volume ?? defaultVolume
              };
            })
          });
        }
        if (trip2.length > 0) {
          cursorMin += 30; // 回 depot 補貨
          tripsArr.push({
            trip_index: 2,
            stops: trip2.map((s, k) => {
              const arrival = formatHM(cursorMin);
              cursorMin += 10 + (s.default_service_minutes ?? 10);
              return {
                stop_id: s.id,
                stop_order: k + 1,
                estimated_arrival_time: arrival,
                estimated_service_minutes: s.default_service_minutes ?? 10,
                estimated_volume: s.avg_delivery_volume ?? defaultVolume
              };
            })
          });
        }

        clusterDocs.push({
          cluster_name: `${bucket.key.split("|")[1]} - ${clusterSeq++}`,
          sequence: clusterDocs.length + 1,
          required_shift: bucket.shift,
          required_temperature: (trip1[0]?.temperature_type as TemperatureType | undefined) ?? undefined,
          estimated_total_minutes: tripMins,
          estimated_total_distance_meters: totalDistance,
          estimated_total_volume: clusterVolume,
          suggested_driver_id: suggestedDriver,
          trips: tripsArr
        });
      }
    }

    const output_plan: OrOutputPlanV2 = {
      engine: "mock",
      engine_version: "mock-v1",
      generated_at: new Date().toISOString(),
      summary: {
        total_clusters: clusterDocs.length,
        total_stops: stops.length,
        total_estimated_minutes: clusterDocs.reduce((s, c) => s + c.estimated_total_minutes, 0),
        total_estimated_distance_meters: clusterDocs.reduce(
          (s, c) => s + c.estimated_total_distance_meters, 0
        ),
        drivers_dispatched: new Set(
          clusterDocs.map((c) => c.suggested_driver_id).filter(Boolean)
        ).size
      },
      clusters: clusterDocs,
      unassigned_stops: []
    };

    await admin
      .from("or_planning_jobs")
      .update({
        status: "completed",
        output_plan,
        completed_at: new Date().toISOString(),
        engine_version: "mock-v1"
      })
      .eq("id", jobId);

    return { output_plan };
  }

  async convertOutputToRoutePlan(jobId: string, createdBy: string | null) {
    const admin = createSupabaseAdminClient();

    const { data: job, error } = await admin
      .from("or_planning_jobs")
      .select("id, planning_period_id, output_plan, created_route_plan_id")
      .eq("id", jobId)
      .single();
    if (error || !job) throw error ?? new Error("OR job not found");
    if (job.created_route_plan_id) {
      return { routePlanId: job.created_route_plan_id as string };
    }

    const output = job.output_plan as OrOutputPlanV2;
    if (!output || !Array.isArray(output.clusters)) {
      throw new Error("Output plan is empty or invalid");
    }

    // 取得目前最大 version
    const { data: maxRow } = await admin
      .from("route_plans")
      .select("version")
      .eq("planning_period_id", job.planning_period_id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (maxRow?.version ?? 0) + 1;

    const { data: plan, error: planErr } = await admin
      .from("route_plans")
      .insert({
        planning_period_id: job.planning_period_id,
        version: nextVersion,
        status: "draft",
        source: "or_mock",
        source_or_job_id: job.id,
        created_by: createdBy,
        notes: `由 OR 試算結果建立（${output.engine_version}）`
      })
      .select("id")
      .single();
    if (planErr || !plan) throw planErr ?? new Error("Failed to create route_plan");

    // 為每個 cluster 建 driver_clusters + driver_route_assignments + route_stops
    for (const c of output.clusters) {
      const { data: clusterRow, error: cErr } = await admin
        .from("driver_clusters")
        .insert({
          route_plan_id: plan.id,
          cluster_name: c.cluster_name,
          sequence: c.sequence,
          estimated_total_minutes: c.estimated_total_minutes,
          estimated_total_distance_meters: c.estimated_total_distance_meters,
          estimated_total_volume: c.estimated_total_volume,
          assigned_driver_id: c.suggested_driver_id ?? null,
          required_shift: c.required_shift ?? null,
          required_temperature: c.required_temperature ?? null
        })
        .select("id")
        .single();
      if (cErr || !clusterRow) throw cErr ?? new Error("Failed to create cluster");

      // 建一筆 dra，把 stops 都掛在它底下（之後 assignment 頁可重指派）
      const { data: dra, error: draErr } = await admin
        .from("driver_route_assignments")
        .insert({
          route_plan_id: plan.id,
          cluster_id: clusterRow.id,
          driver_id: c.suggested_driver_id ?? null,
          route_name: c.cluster_name,
          sequence: c.sequence,
          estimated_total_minutes: c.estimated_total_minutes,
          estimated_total_distance_meters: c.estimated_total_distance_meters
        })
        .select("id")
        .single();
      if (draErr || !dra) throw draErr ?? new Error("Failed to create assignment");

      // 把 trip 內所有 stops 寫到 route_stops
      const rows: Array<{
        driver_route_assignment_id: string;
        cluster_id: string;
        stop_id: string;
        stop_order: number;
        trip_index: number;
        estimated_arrival_time: string;
        estimated_service_minutes: number;
      }> = [];
      // 兩個 trip 共享 stop_order，但 trip_index 不同；DB unique(driver_route_assignment_id, stop_order)
      // 為了避開衝突，把 trip 2 的 order 接在 trip 1 之後
      let globalOrder = 1;
      for (const trip of c.trips) {
        for (const s of trip.stops) {
          rows.push({
            driver_route_assignment_id: dra.id,
            cluster_id: clusterRow.id,
            stop_id: s.stop_id,
            stop_order: globalOrder++,
            trip_index: trip.trip_index,
            estimated_arrival_time: s.estimated_arrival_time,
            estimated_service_minutes: s.estimated_service_minutes
          });
        }
      }
      if (rows.length > 0) {
        const { error: rsErr } = await admin.from("route_stops").insert(rows);
        if (rsErr) throw rsErr;
      }
    }

    await admin
      .from("or_planning_jobs")
      .update({
        created_route_plan_id: plan.id,
        draft_route_plan_id:   plan.id
      })
      .eq("id", job.id);

    return { routePlanId: plan.id as string };
  }
}

function formatHM(minOfDay: number): string {
  const h = Math.floor(minOfDay / 60).toString().padStart(2, "0");
  const m = (minOfDay % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

export const orPlanningService: IORPlanningService = new MockORPlanningService();

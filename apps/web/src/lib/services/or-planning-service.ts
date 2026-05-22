import "server-only";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { OrOutputPlanV2, ShiftType, TemperatureType, TripIndex } from "@/types/domain";
import { getOrComputeCachedMatrix } from "@/lib/services/duration-matrix-cache-service";
import { geocodeAddress } from "@/lib/services/tomtom-geocoding-service";

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
  /**
   * 跑真實 Python Gurobi MTVRP。OR-engine 沒裝/壞了會自動 fallback 到 mock。
   * 回傳結果一律符合 OrOutputPlanV2 schema。
   * fallback 時 `fallback_reason` 帶實際失敗原因（python 找不到 / gurobipy 沒裝 / matrix 失敗…）。
   */
  runRealPlanningJob(jobId: string): Promise<{
    output_plan: OrOutputPlanV2;
    engine_used: "gurobi" | "mock-fallback";
    fallback_reason?: string;
    diagnostics?: Record<string, unknown>;
  }>;
  convertOutputToRoutePlan(jobId: string, createdBy: string | null): Promise<{ routePlanId: string }>;
}

interface StopRow {
  id: string;
  address: string;
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

    // 預設容量（input_parameters.defaults.vehicle_capacity_boxes 沒給就用 250，對齊 OR_new MVP seed）
    const params = (job.input_parameters ?? {}) as Record<string, any>;
    const defaultCapacity: number = params?.defaults?.vehicle_capacity_boxes ?? 250;
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
    // ★ 全域記錄哪些 driver 已被指派 → 避免 driver_route_assignments unique(plan, driver_id) 撞 key
    const assignedDriverIds = new Set<string>();

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

        // 先從還沒被指派過的 driver 裡挑（避免 mock 把同一人塞給多個 cluster）
        const freeDrivers = eligibleDrivers.filter((d) => !assignedDriverIds.has(d.id));
        const suggestedDriver = freeDrivers.length > 0
          ? freeDrivers[0].id
          : null;       // 沒空閒 driver → 留 null，採用時主管可以再去 /assignment 補
        if (suggestedDriver) assignedDriverIds.add(suggestedDriver);

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

        const routeCode = `R-${String(clusterSeq).padStart(3, "0")}`;
        clusterSeq++;
        clusterDocs.push({
          cluster_name: `${routeCode}（${bucket.key.split("|")[1]}）`,
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

  /**
   * 真實 OR：呼叫 or-engine/solver_main.py。
   *
   * 流程：
   *   1. 抓 stops / drivers / depot
   *   2. 用 TomTom 算 (depot+stops) x (depot+stops) 行車時間矩陣
   *   3. 組 JSON 餵給 Python subprocess
   *   4. 解析輸出，轉成 OrOutputPlanV2 寫回 job
   *
   * 任何環節失敗（Python 沒裝 / TomTom 沒 key / solver 找不到解）→ 自動 fallback 跑 mock。
   */
  async runRealPlanningJob(jobId: string) {
    const admin = createSupabaseAdminClient();

    const { data: job, error: jobErr } = await admin
      .from("or_planning_jobs")
      .select("id, planning_period_id, input_parameters, weights")
      .eq("id", jobId)
      .single();
    if (jobErr || !job) throw jobErr ?? new Error("OR job not found");

    await admin
      .from("or_planning_jobs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", jobId);

    const params = (job.input_parameters ?? {}) as Record<string, any>;
    const weightsRaw = (job.weights ?? params?.weights ?? {}) as Record<string, any>;
    // OR python 5 個權重：α 工時 / β 派工 / γ 加班 / δ_W 工時平衡 / δ_B 箱數平衡
    const alpha   = Number(weightsRaw?.alpha_travel_time ?? weightsRaw?.alpha   ?? 1.0);
    const beta    = Number(weightsRaw?.beta_dispatch     ?? weightsRaw?.beta    ?? 300.0);
    const gamma   = Number(weightsRaw?.gamma_overtime    ?? weightsRaw?.gamma   ?? 1.5);
    const deltaW  = Number(weightsRaw?.delta_workload    ?? weightsRaw?.delta_w ?? 0.0);
    const deltaB  = Number(weightsRaw?.delta_boxes       ?? weightsRaw?.delta_b ?? 0.0);
    // H̄ / H — UI 上是兩個獨立欄位；舊版可能在 defaults.max_work_minutes 或 workload.max_minutes_per_driver
    const hoursMax = Number(
      params?.hours?.max_work_minutes
        ?? params?.defaults?.max_work_minutes
        ?? params?.workload?.max_minutes_per_driver ?? 720
    );
    const hoursOt  = Number(
      params?.hours?.overtime_threshold ?? 480
    );
    // Q / σ 不在這個 UI 設定，從 driver / stop master 抓；沒設就用這個 fallback
    // (250 = OR_new MVP seed 的 driver vehicle_capacity)
    const fallbackCapacity     = 250;
    const fallbackServiceMin   = 10;
    const numTrips: number = params?.num_trips ?? 2;
    const timeLimitSec = Number(process.env.OR_ENGINE_TIMEOUT_SEC ?? "120");
    const mipGap = Number(params?.mip_gap ?? 0.05);

    // ---- 抓 DC + stops + drivers ----
    const { data: period } = await admin
      .from("planning_periods")
      .select("id, distribution_center_id")
      .eq("id", job.planning_period_id)
      .single();

    interface DcRow { id: string; name: string; lat: number | null; lng: number | null; }
    const { data: dc } = await admin
      .from("distribution_centers")
      .select("id, name, lat, lng")
      .eq("id", period?.distribution_center_id ?? "")
      .maybeSingle<DcRow>();

    const { data: driversRaw } = await admin
      .from("profiles")
      .select("id, full_name, shift, vehicle_capacity, max_work_minutes, temperature_capability")
      .eq("role", "driver")
      .eq("is_active", true)
      .eq("distribution_center_id", period?.distribution_center_id ?? null)
      .returns<(DriverRow & { max_work_minutes?: number | null })[]>();

    const { data: stopsRaw } = await admin
      .from("stops")
      .select(
        "id, name, address, default_service_minutes, avg_delivery_volume, " +
          "shift, temperature_type, lat, lng, city, district"
      )
      .eq("is_active", true)
      .returns<(StopRow & { name: string })[]>();

    const drivers = driversRaw ?? [];
    const stops   = stopsRaw ?? [];

    // 啟動診斷資訊（fallback 時也帶回去）
    const diagnostics: Record<string, unknown> = {
      python_exe: process.env.OR_ENGINE_PYTHON ?? "python (default)",
      engine_root: process.env.OR_ENGINE_ROOT ?? "<auto-resolve from cwd>",
      cwd: process.cwd(),
      stops_count: stops.length,
      drivers_count: drivers.length,
      tomtom_key_set: Boolean(process.env.TOMTOM_API_KEY)
    };

    if (drivers.length === 0 || stops.length === 0) {
      return this.runRealFallback(jobId, "no-driver-or-stop", diagnostics);
    }

    // ★ 自動 geocode 缺座標的 stops（避免 OR 拿到 (0,0) 算出跨地球的離譜時間）
    //   只 geocode 「有地址但 lat 或 lng 為 null」的 stop，補完後直接寫回 DB。
    let autoGeocodedDuringRun = 0;
    if (process.env.TOMTOM_API_KEY) {
      const stopsToGeocode = stops.filter(
        (s) => (s.lat == null || s.lng == null) && s.address
      );
      for (const s of stopsToGeocode) {
        const g = await geocodeAddress(s.address);
        if (g) {
          s.lat = g.lat;
          s.lng = g.lng;
          await admin.from("stops").update({ lat: g.lat, lng: g.lng }).eq("id", s.id);
          autoGeocodedDuringRun++;
        }
      }
    }
    diagnostics.auto_geocoded_during_run = autoGeocodedDuringRun;

    // ---- Pre-flight：先做幾個 feasibility check，避免直接送 Gurobi infeasible ----
    // 1. 過濾掉「沒有任何 driver 能服務」的 stop（班別不匹配）
    //    這些站不能服務不是 OR 的錯，是資料不對齊；把它們列為 unassigned 而不是 infeasible
    const driverShifts = new Set(
      drivers.map((d) => shiftToInt(d.shift as ShiftType | null))
    );
    const serviceableStops: typeof stops = [];
    const skippedShiftStops: string[] = [];
    for (const s of stops) {
      const stopShift = shiftToInt(s.shift as ShiftType | null);
      if (!driverShifts.has(stopShift)) {
        skippedShiftStops.push(s.id);
      } else {
        serviceableStops.push(s);
      }
    }
    diagnostics.skipped_due_to_shift = skippedShiftStops.length;

    if (serviceableStops.length === 0) {
      return this.runRealFallback(
        jobId,
        `所有 ${stops.length} 個 stop 的班別都跟現有 driver 不匹配。` +
        `現有 driver 班別：[${[...driverShifts].map((s) => s === 1 ? "day" : "night").join(", ")}]`,
        diagnostics
      );
    }

    // 2. 容量檢查 — 按 shift 分別算（OR 內部約束是 per-shift 切分的）
    const dayStops   = serviceableStops.filter((s) => shiftToInt(s.shift as ShiftType | null) === 1);
    const nightStops = serviceableStops.filter((s) => shiftToInt(s.shift as ShiftType | null) === 2);
    const dayDrivers   = drivers.filter((d) => shiftToInt(d.shift as ShiftType | null) === 1);
    const nightDrivers = drivers.filter((d) => shiftToInt(d.shift as ShiftType | null) === 2);

    const sumDemand = (arr: typeof stops) =>
      arr.reduce((s, x) => s + (x.avg_delivery_volume ?? 1), 0);
    const sumCap = (arr: typeof drivers) =>
      arr.reduce((s, d) => s + (d.vehicle_capacity ?? fallbackCapacity), 0) * numTrips;
    const minCap = (arr: typeof drivers) =>
      arr.length === 0 ? 0 : Math.min(...arr.map((d) => d.vehicle_capacity ?? fallbackCapacity));
    const maxCap = (arr: typeof drivers) =>
      arr.length === 0 ? 0 : Math.max(...arr.map((d) => d.vehicle_capacity ?? fallbackCapacity));

    const totalDemand   = sumDemand(serviceableStops);
    const totalCapacity = sumCap(drivers);
    const dayDemand   = sumDemand(dayStops);
    const dayCapacity = sumCap(dayDrivers);
    const nightDemand   = sumDemand(nightStops);
    const nightCapacity = sumCap(nightDrivers);

    diagnostics.total_demand   = totalDemand;
    diagnostics.total_capacity = totalCapacity;
    diagnostics.day_demand     = dayDemand;
    diagnostics.day_capacity   = dayCapacity;
    diagnostics.night_demand   = nightDemand;
    diagnostics.night_capacity = nightCapacity;
    diagnostics.serviceable_stops = serviceableStops.length;
    diagnostics.num_trips      = numTrips;
    diagnostics.driver_capacity_min = minCap(drivers);
    diagnostics.driver_capacity_max = maxCap(drivers);

    // 容量太低 → 提示主管 DB seed 可能還是舊值（OR_new MVP 預期 250/driver）
    const looksLikeStaleCapacity = maxCap(drivers) > 0 && maxCap(drivers) < 200;
    const staleCapacityHint = looksLikeStaleCapacity
      ? `（偵測到 driver 容量偏低：每位最高 ${maxCap(drivers)} 箱，預期應為 250。` +
        `請執行 supabase/seed/patch_driver_capacity_to_250.sql 修正。）`
      : ``;

    // 任一班別 demand > capacity 都 infeasible
    if (dayDemand > dayCapacity) {
      return this.runRealFallback(
        jobId,
        `日班需求 ${dayDemand} > 日班容量 ${dayCapacity}（${dayDrivers.length} 位日班 driver × ${numTrips} 趟，每位最高 ${maxCap(dayDrivers)} 箱）。` +
        `多開日班 driver、把 num_trips 改 2、或執行 patch SQL 把 driver 容量補到 250。${staleCapacityHint}`,
        diagnostics
      );
    }
    if (nightDemand > nightCapacity) {
      return this.runRealFallback(
        jobId,
        `夜班需求 ${nightDemand} > 夜班容量 ${nightCapacity}（${nightDrivers.length} 位夜班 driver × ${numTrips} 趟，每位最高 ${maxCap(nightDrivers)} 箱）。` +
        `多開夜班 driver 或把部分 stops 改為日班。${staleCapacityHint}`,
        diagnostics
      );
    }
    if (totalDemand > totalCapacity) {
      return this.runRealFallback(
        jobId,
        `總需求 ${totalDemand} 箱 > 總容量 ${totalCapacity} 箱（${drivers.length} 司機 × 容量 × ${numTrips} 趟）。` +
        `請：(a) 增加司機 / 容量 / 趟次，或 (b) 暫時停用部分 stops，或 (c) 降低 stops 的 avg_delivery_volume。${staleCapacityHint}`,
        diagnostics
      );
    }

    // ---- Duration matrix（先查 DB cache，缺的才打 TomTom）----
    const depotLatLng = {
      lat: Number(dc?.lat ?? 25.0610),
      lng: Number(dc?.lng ?? 121.4847)
    };
    const nodes = [
      { id: dc?.id ?? "depot", ...depotLatLng },
      ...serviceableStops.map((s) => ({
        id: s.id,
        lat: Number(s.lat ?? 0),
        lng: Number(s.lng ?? 0)
      }))
    ];
    const matrix = await getOrComputeCachedMatrix(nodes);
    diagnostics.matrix_cache_hits   = matrix.cache_hits;
    diagnostics.matrix_fresh_fetched = matrix.fresh_fetched;

    // ---- 組 Python 輸入 ----
    const pyInput = {
      depot: { id: dc?.id ?? "depot", lat: depotLatLng.lat, lng: depotLatLng.lng },
      stops: serviceableStops.map((s) => ({
        id: s.id,
        lat: Number(s.lat ?? 0),
        lng: Number(s.lng ?? 0),
        demand: s.avg_delivery_volume ?? 1,
        service_minutes: s.default_service_minutes ?? fallbackServiceMin,
        shift: shiftToInt(s.shift as ShiftType | null)
      })),
      drivers: drivers.map((d) => ({
        id: d.id,
        shift: shiftToInt(d.shift as ShiftType | null),
        capacity: d.vehicle_capacity ?? fallbackCapacity,
        // H̄ / H 從 UI 的「工時規則」全域帶入；個別 driver 的 profile 有設就以 profile 優先
        max_minutes:        (d as any).max_work_minutes ?? hoursMax,
        overtime_threshold: hoursOt
      })),
      tau: matrix.durationMinutes,
      weights: {
        alpha, beta, gamma,
        delta_w: deltaW,
        delta_b: deltaB
      },
      num_trips: numTrips,
      time_limit_sec: timeLimitSec,
      mip_gap: mipGap
    };

    // ---- spawn Python ----
    let pyResult: PythonSolverOutput;
    try {
      pyResult = await spawnSolver(pyInput, timeLimitSec, diagnostics);
    } catch (e: any) {
      console.warn("[or-engine] subprocess failed, falling back:", e?.message ?? e);
      return this.runRealFallback(jobId, `subprocess_error: ${e?.message ?? e}`, diagnostics);
    }

    if (!pyResult.ok) {
      console.warn("[or-engine] solver returned not-ok:", pyResult.error_kind, pyResult.error);
      // status=3 = INFEASIBLE，特別給人話的訊息（雖然我們已經 pre-check，這是雙保險）
      let reason = `solver_${pyResult.error_kind}: ${pyResult.error}`;
      if (pyResult.error?.includes("status=3")) {
        reason =
          `Gurobi 找不到可行解（infeasible）。Pre-check 過了（` +
          `需求 ${diagnostics.total_demand} ≤ 容量 ${diagnostics.total_capacity}、` +
          `${diagnostics.skipped_due_to_shift ?? 0} 個 stop 因班別無法服務）。` +
          `Gurobi 用：H̄=${hoursMax} 分鐘 / H=${hoursOt} 分鐘、num_trips=${numTrips}、` +
          `α=${alpha}, β=${beta}, γ=${gamma}, δ_W=${deltaW}, δ_B=${deltaB}。` +
          `常見可行解卡點：` +
          `(a) 班別切分讓單一班的 stops 容量塞不下（看 day vs night 的 capacity 是否真的能 cover demand）；` +
          `(b) 某些 stops 的 demand > 任一 driver 的 capacity；` +
          `(c) 工時 H̄ 太緊（單一 driver 工時 + 服務時間總和超過 H̄）。`;
      }
      return this.runRealFallback(jobId, reason, diagnostics);
    }

    // ---- Python output → OrOutputPlanV2 ----
    const output_plan = buildOutputPlanV2(pyResult, serviceableStops, drivers, matrix.isReal);
    // 把 pre-flight 過濾掉的 stops（班別沒匹配）也回報為 unassigned，讓主管看到
    if (skippedShiftStops.length > 0) {
      output_plan.unassigned_stops = [
        ...(output_plan.unassigned_stops ?? []),
        ...skippedShiftStops
      ];
      output_plan.metadata = {
        ...(output_plan.metadata ?? {}),
        skipped_shift_count: skippedShiftStops.length
      };
    }

    await admin
      .from("or_planning_jobs")
      .update({
        status: "completed",
        output_plan,
        completed_at: new Date().toISOString(),
        engine_version: "gurobi-v1"
      })
      .eq("id", jobId);

    return { output_plan, engine_used: "gurobi" as const };
  }

  private async runRealFallback(
    jobId: string,
    reason: string,
    diagnostics?: Record<string, unknown>
  ) {
    const admin = createSupabaseAdminClient();
    const r = await this.runMockPlanningJob(jobId);
    await admin
      .from("or_planning_jobs")
      .update({ notes: `Gurobi 不可用，已 fallback mock：${reason}` })
      .eq("id", jobId);
    return {
      output_plan: r.output_plan,
      engine_used: "mock-fallback" as const,
      fallback_reason: reason,
      diagnostics
    };
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
    // ★ 防呆：同 plan 內 driver_id 必須唯一（DB unique(plan, driver)），重複出現的 cluster
    //   只在 driver_clusters.assigned_driver_id 保留建議，driver_route_assignments.driver_id 設為 null
    const usedDriverIds = new Set<string>();
    for (const c of output.clusters) {
      const suggested = c.suggested_driver_id ?? null;
      const draDriverId =
        suggested && !usedDriverIds.has(suggested) ? suggested : null;
      if (draDriverId) usedDriverIds.add(draDriverId);

      const { data: clusterRow, error: cErr } = await admin
        .from("driver_clusters")
        .insert({
          route_plan_id: plan.id,
          cluster_name: c.cluster_name,
          sequence: c.sequence,
          estimated_total_minutes: c.estimated_total_minutes,
          estimated_total_distance_meters: c.estimated_total_distance_meters,
          estimated_total_volume: c.estimated_total_volume,
          assigned_driver_id: draDriverId,
          required_shift: c.required_shift ?? null,
          required_temperature: c.required_temperature ?? null
        })
        .select("id")
        .single();
      if (cErr || !clusterRow) {
        throw new Error(
          `Failed to create cluster "${c.cluster_name}": ${cErr?.message ?? "unknown"}`
        );
      }

      // 建一筆 dra，把 stops 都掛在它底下（之後 assignment 頁可重指派）
      let dra: { id: string } | null = null;
      {
        const { data, error: draErr } = await admin
          .from("driver_route_assignments")
          .insert({
            route_plan_id: plan.id,
            cluster_id: clusterRow.id,
            driver_id: draDriverId,
            route_name: c.cluster_name,
            sequence: c.sequence,
            estimated_total_minutes: c.estimated_total_minutes,
            estimated_total_distance_meters: c.estimated_total_distance_meters
          })
          .select("id")
          .single();
        // 即使我們前面有 dedupe，碰到 23505（unique driver_id）就 fallback 把 driver 設 null 再 insert
        if (draErr && (draErr as { code?: string }).code === "23505") {
          console.warn(
            `[or-engine] dra unique conflict for cluster "${c.cluster_name}" ` +
            `(driver=${draDriverId}) — retrying with driver_id=null`
          );
          // 同步把 driver_clusters.assigned_driver_id 清掉，避免兩邊不一致
          await admin
            .from("driver_clusters")
            .update({ assigned_driver_id: null })
            .eq("id", clusterRow.id);
          const retry = await admin
            .from("driver_route_assignments")
            .insert({
              route_plan_id: plan.id,
              cluster_id: clusterRow.id,
              driver_id: null,
              route_name: c.cluster_name,
              sequence: c.sequence,
              estimated_total_minutes: c.estimated_total_minutes,
              estimated_total_distance_meters: c.estimated_total_distance_meters
            })
            .select("id")
            .single();
          if (retry.error || !retry.data) {
            throw new Error(
              `Retry without driver failed for "${c.cluster_name}": ${retry.error?.message ?? "unknown"}`
            );
          }
          dra = retry.data;
        } else if (draErr || !data) {
          throw new Error(
            `Failed to create assignment for "${c.cluster_name}" ` +
            `(driver=${draDriverId}): ${draErr?.message ?? "unknown"}`
          );
        } else {
          dra = data;
        }
      }

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
        if (rsErr) {
          throw new Error(
            `Failed to insert route_stops for "${c.cluster_name}": ${rsErr.message}`
          );
        }
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

function shiftToInt(s: ShiftType | null | undefined): number {
  return s === "night" ? 2 : 1;
}

// ============================================================
// Python OR engine 整合
// ============================================================

interface PythonSolverOutput {
  ok: boolean;
  error_kind?: string;
  error?: string;
  status?: number;
  objective?: number;
  best_bound?: number;
  gap?: number;
  runtime_sec?: number;
  drivers_used?: number;
  drivers?: Array<{
    id: string;
    dispatched: boolean;
    total_work_minutes: number;
    overtime_minutes: number;
    total_boxes?: number;
  }>;
  routes?: Array<{
    driver_id: string;
    trip_index: number;
    start_minute: number;
    end_minute: number;
    trip_drive_minutes: number;
    trip_service_minutes: number;
    trip_total_demand: number;
    stops: Array<{
      stop_id: string;
      stop_order: number;
      arrival_minute: number;
      service_minutes: number;
      demand: number;
    }>;
  }>;
  unassigned_stops?: string[];
  /** 平衡指標：最忙最閒差距（OR python balance block） */
  balance?: {
    work_min_range: number;
    work_min_max:   number;
    work_min_min:   number;
    box_range:      number;
    box_max:        number;
    box_min:        number;
  };
}

function resolvePythonExe(engineRoot: string): string {
  // 1) 顯式指定優先
  if (process.env.OR_ENGINE_PYTHON) return process.env.OR_ENGINE_PYTHON;
  // 2) 自動偵測 or-engine/.venv/
  const candidates =
    process.platform === "win32"
      ? [
          path.join(engineRoot, ".venv", "Scripts", "python.exe"),
          path.join(engineRoot, "venv", "Scripts", "python.exe"),
        ]
      : [
          path.join(engineRoot, ".venv", "bin", "python"),
          path.join(engineRoot, "venv", "bin", "python"),
        ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // 3) Windows 通常用 'py' launcher 比 'python' 穩
  return process.platform === "win32" ? "py" : "python3";
}

function spawnSolver(
  input: unknown,
  timeoutSec: number,
  diagnostics: Record<string, unknown>
): Promise<PythonSolverOutput> {
  const engineRoot = process.env.OR_ENGINE_ROOT
    ?? path.resolve(process.cwd(), "..", "..", "or-engine");
  const pythonExe = resolvePythonExe(engineRoot);
  const scriptPath = path.join(engineRoot, "solver_main.py");

  diagnostics.resolved_python = pythonExe;
  diagnostics.resolved_engine_root = engineRoot;
  diagnostics.resolved_script = scriptPath;
  diagnostics.venv_detected = pythonExe.includes(".venv") || pythonExe.includes("venv");

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(pythonExe, [scriptPath], {
        cwd: engineRoot,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" }
      });
    } catch (e: any) {
      return reject(new Error(`spawn() threw: ${e?.message ?? e} (python=${pythonExe})`));
    }

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      try { child.kill("SIGKILL"); } catch { /* noop */ }
    }, (timeoutSec + 30) * 1000);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (err: any) => {
      clearTimeout(timer);
      diagnostics.spawn_error = err?.message ?? String(err);
      diagnostics.spawn_errno = err?.code;
      reject(new Error(
        `spawn failed: ${err?.message ?? err} (python="${pythonExe}", code=${err?.code}). ` +
        `Likely 'python' not on PATH or path wrong; set OR_ENGINE_PYTHON in .env.local.`
      ));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      diagnostics.exit_code = code;
      diagnostics.stderr_tail = stderr.slice(-400);
      diagnostics.stdout_tail = stdout.slice(-400);
      if (killed) return reject(new Error(`solver timeout after ${timeoutSec}s`));
      if (code !== 0 && !stdout.trim()) {
        return reject(new Error(`python exited ${code}: ${stderr.slice(0, 500) || "(no stderr)"}`));
      }
      try {
        const line = stdout.trim().split(/\r?\n/).reverse().find((l) => l.startsWith("{"));
        if (!line) return reject(new Error(`solver stdout has no JSON: ${stdout.slice(-500)}`));
        resolve(JSON.parse(line) as PythonSolverOutput);
      } catch (e: any) {
        reject(new Error(`parse solver output failed: ${e?.message ?? e}`));
      }
    });

    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

function buildOutputPlanV2(
  py: PythonSolverOutput,
  stops: Array<StopRow & { name: string }>,
  drivers: DriverRow[],
  matrixIsReal: boolean
): OrOutputPlanV2 {
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const stopById   = new Map(stops.map((s) => [s.id, s]));

  // 把 (driver_id, trip_index) → stops 聚合成 1 個 cluster per driver
  const byDriver = new Map<string, { trips: Map<number, NonNullable<PythonSolverOutput["routes"]>[number]>; }>();
  for (const route of py.routes ?? []) {
    if (!byDriver.has(route.driver_id)) {
      byDriver.set(route.driver_id, { trips: new Map() });
    }
    byDriver.get(route.driver_id)!.trips.set(route.trip_index, route);
  }

  const clusters: OrOutputPlanV2["clusters"] = [];
  let seq = 1;
  const startBaseMin = 8 * 60 + 30; // 08:30

  for (const [driverId, info] of byDriver.entries()) {
    const driver = driverById.get(driverId);
    const tripList = Array.from(info.trips.entries()).sort(([a], [b]) => a - b);

    const totalMin = tripList.reduce((sum, [, t]) => sum + t.trip_drive_minutes + t.trip_service_minutes, 0);
    const totalDemand = tripList.reduce((sum, [, t]) => sum + t.trip_total_demand, 0);

    // 推測 cluster 的 required_temperature：用 trip 1 第一站 fallback
    const firstStopId = tripList[0]?.[1]?.stops?.[0]?.stop_id;
    const firstStop = firstStopId ? stopById.get(firstStopId) : undefined;

    const trips: OrOutputPlanV2["clusters"][number]["trips"] = tripList.map(([tripIdx, t]) => ({
      trip_index: tripIdx as TripIndex,
      stops: t.stops.map((s, k) => ({
        stop_id: s.stop_id,
        stop_order: k + 1,
        estimated_arrival_time: formatHM(startBaseMin + Math.round(s.arrival_minute)),
        estimated_service_minutes: Math.round(s.service_minutes),
        estimated_volume: s.demand
      }))
    }));

    const routeCode = `R-${String(seq).padStart(3, "0")}`;
    clusters.push({
      cluster_name: driver?.full_name
        ? `${routeCode}（${driver.full_name}）`
        : routeCode,
      sequence: seq++,
      required_shift: (driver?.shift as ShiftType | null) ?? undefined,
      required_temperature: (firstStop?.temperature_type as TemperatureType | null) ?? undefined,
      estimated_total_minutes: Math.round(totalMin),
      estimated_total_distance_meters: 0,         // 真實距離可後續從 matrix 算出
      estimated_total_volume: totalDemand,
      suggested_driver_id: driverId,
      trips
    });
  }

  const totalStops = clusters.reduce(
    (s, c) => s + c.trips.reduce((ss, t) => ss + t.stops.length, 0), 0
  );

  return {
    engine: "gurobi",
    engine_version: "gurobi-v1",
    generated_at: new Date().toISOString(),
    objective_value: py.objective,
    summary: {
      total_clusters: clusters.length,
      total_stops: totalStops,
      total_estimated_minutes: clusters.reduce((s, c) => s + c.estimated_total_minutes, 0),
      total_estimated_distance_meters: 0,
      drivers_dispatched: py.drivers_used ?? clusters.length
    },
    clusters,
    unassigned_stops: py.unassigned_stops ?? [],
    metadata: {
      gap: py.gap,
      runtime_sec: py.runtime_sec,
      matrix_source: matrixIsReal ? "tomtom" : "haversine",
      // OR python 回的平衡指標 — UI 可顯示「最忙最閒差距」
      balance: py.balance ?? null
    }
  };
}

export const orPlanningService: IORPlanningService = new MockORPlanningService();

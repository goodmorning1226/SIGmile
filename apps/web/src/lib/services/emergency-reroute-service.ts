import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { haversineMeters, type LatLng } from "./or/kernel/distance";

/**
 * 緊急應變服務 — driver-down 時 AI 重新分派 pending stops。
 *
 * 流程：
 *   1. GET /api/manager/emergency/today  → 列出今日所有 driver 進度
 *   2. POST /api/manager/emergency/plan   → 給定 down driver_id，AI 算重派方案（不寫 DB）
 *   3. POST /api/manager/emergency/apply  → 確認後寫回 delivery_task_stops
 *
 * 演算法：cheapest-insertion 把 down driver 的 pending stops 分到其他 driver。
 *   - 排序：vipPriority → 時間窗緊迫 → demand 大 (依序處理避免大件卡住)
 *   - 每站找「最便宜 Δkm 且不違反容量 / 溫層 / 班別」的 driver
 *   - 若沒有 driver 接得到 → 列入 unassignable（主管手動處理）
 */

interface TaskRow {
  id: string;
  driver_id: string;
  delivery_date: string;
  status: string;
  driver: { full_name: string; employee_code: string | null; shift: string | null;
    vehicle_capacity: number | null; temperature_capability: string | null; } |
    Array<{ full_name: string; employee_code: string | null; shift: string | null;
      vehicle_capacity: number | null; temperature_capability: string | null; }> | null;
}

interface TaskStopRow {
  id: string;
  delivery_task_id: string;
  stop_id: string;
  stop_order: number;
  trip_index: number;
  status: string;
  planned_arrival_at: string | null;
  actual_arrival_at: string | null;
  // delivery_task_stops 沒存 estimated_*；統一從 stops 主檔 derive
  stop: {
    id: string;
    name: string;
    external_code: string | null;
    lat: number | null;
    lng: number | null;
    temperature_type: string | null;
    shift: string | null;
    avg_delivery_volume: number | null;
    default_service_minutes: number | null;
  } | Array<{
    id: string; name: string; external_code: string | null;
    lat: number | null; lng: number | null;
    temperature_type: string | null; shift: string | null;
    avg_delivery_volume: number | null;
    default_service_minutes: number | null;
  }> | null;
}

function pickFirst<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function todayInTaipei(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.APP_TIMEZONE ?? "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

// ─────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────
export interface DriverSnapshot {
  driver_id: string;
  driver_name: string;
  employee_code: string | null;
  shift: string | null;
  vehicle_capacity: number;
  temperature_capability: string[];
  task_id: string | null;
  task_status: string;
  total_stops: number;
  completed_stops: number;
  pending_stops: number;
  current_lat: number | null;
  current_lng: number | null;
  last_completed_at: string | null;
}

export interface ReassignedStop {
  task_stop_id: string;
  stop_id: string;
  stop_name: string;
  /** 原 driver */
  from_driver_id: string;
  from_driver_name: string;
  /** 新 driver；null = 無人可接 */
  to_driver_id: string | null;
  to_driver_name: string | null;
  /** 在新 driver 路線中插在第 N 個 pending 之後 */
  insertion_after_index: number | null;
  /** 插入造成的 Δkm */
  delta_km: number;
  reason: string;
  /** 無人可接的原因（若 to_driver_id null） */
  unassign_reason: string | null;
}

export interface ReroutePlan {
  date: string;
  down_driver: DriverSnapshot;
  reassigned: ReassignedStop[];
  unassignable: ReassignedStop[];
  summary: {
    pending_taken: number;
    distributed_to_drivers: number;
    total_delta_km: number;
    confidence: number;   // 0..1
  };
}

// ─────────────────────────────────────────────────────────────
// Read today's snapshot
// ─────────────────────────────────────────────────────────────
export async function getTodaySnapshot(opts: { date?: string } = {}): Promise<{
  date: string;
  drivers: DriverSnapshot[];
}> {
  const admin = createSupabaseAdminClient();
  const targetDate = opts.date ?? todayInTaipei();

  // 找今天 tasks；找不到 fallback 最近一天
  let date = targetDate;
  let { data: tasks } = await admin
    .from("delivery_tasks")
    .select(
      "id, driver_id, delivery_date, status, " +
        "driver:profiles(full_name, employee_code, shift, vehicle_capacity, temperature_capability)"
    )
    .eq("delivery_date", date)
    .returns<TaskRow[]>();
  if ((tasks ?? []).length === 0) {
    const { data: latest } = await admin
      .from("delivery_tasks")
      .select("delivery_date")
      .order("delivery_date", { ascending: false })
      .limit(1)
      .maybeSingle<{ delivery_date: string }>();
    if (latest?.delivery_date) {
      date = latest.delivery_date;
      const r = await admin
        .from("delivery_tasks")
        .select(
          "id, driver_id, delivery_date, status, " +
            "driver:profiles(full_name, employee_code, shift, vehicle_capacity, temperature_capability)"
        )
        .eq("delivery_date", date)
        .returns<TaskRow[]>();
      tasks = r.data;
    }
  }
  const taskList = tasks ?? [];

  if (taskList.length === 0) return { date, drivers: [] };

  // 抓 stops
  const taskIds = taskList.map((t) => t.id);
  const { data: stops } = await admin
    .from("delivery_task_stops")
    .select(
      "id, delivery_task_id, stop_id, stop_order, trip_index, status, " +
        "planned_arrival_at, actual_arrival_at, " +
        "stop:stops(id, name, external_code, lat, lng, temperature_type, shift, " +
        "avg_delivery_volume, default_service_minutes)"
    )
    .in("delivery_task_id", taskIds)
    .order("stop_order", { ascending: true })
    .returns<TaskStopRow[]>();
  const stopList = stops ?? [];

  const drivers: DriverSnapshot[] = taskList.map((t) => {
    const d = pickFirst(t.driver);
    const ownStops = stopList.filter((s) => s.delivery_task_id === t.id);
    const completed = ownStops.filter((s) => s.status === "completed" || s.status === "arrived");
    const pending = ownStops.filter((s) => s.status === "pending" || s.status === "navigating");
    const last = [...completed].reverse()[0];
    const lastStop = last ? pickFirst(last.stop) : null;
    return {
      driver_id: t.driver_id,
      driver_name: d?.full_name ?? "(未知)",
      employee_code: d?.employee_code ?? null,
      shift: d?.shift ?? null,
      vehicle_capacity: d?.vehicle_capacity ?? 250,  // 對齊 OR_new MVP seed
      temperature_capability: (d?.temperature_capability ?? "ambient,mixed,chilled,frozen")
        .split(",").map((x) => x.trim()).filter(Boolean),
      task_id: t.id,
      task_status: t.status,
      total_stops: ownStops.length,
      completed_stops: completed.length,
      pending_stops: pending.length,
      current_lat: lastStop?.lat ?? null,
      current_lng: lastStop?.lng ?? null,
      last_completed_at: last?.actual_arrival_at ?? null
    };
  });

  return { date, drivers };
}

// ─────────────────────────────────────────────────────────────
// Plan reroute (no DB write)
// ─────────────────────────────────────────────────────────────
export async function planReroute(opts: {
  date?: string;
  down_driver_id: string;
}): Promise<ReroutePlan> {
  const admin = createSupabaseAdminClient();
  const snap = await getTodaySnapshot({ date: opts.date });
  const down = snap.drivers.find((d) => d.driver_id === opts.down_driver_id);
  if (!down) throw new Error(`找不到 driver ${opts.down_driver_id} 在 ${snap.date} 的任務`);
  if (!down.task_id) throw new Error(`driver ${opts.down_driver_id} 在 ${snap.date} 沒有 task`);

  // 把 down driver 的 pending stops 抓出來
  const { data: downStops } = await admin
    .from("delivery_task_stops")
    .select(
      "id, delivery_task_id, stop_id, stop_order, trip_index, status, " +
        "planned_arrival_at, actual_arrival_at, " +
        "stop:stops(id, name, external_code, lat, lng, temperature_type, shift, " +
        "avg_delivery_volume, default_service_minutes)"
    )
    .eq("delivery_task_id", down.task_id)
    .in("status", ["pending", "navigating"])
    .order("stop_order", { ascending: true })
    .returns<TaskStopRow[]>();
  const pendingPool = downStops ?? [];

  if (pendingPool.length === 0) {
    return {
      date: snap.date,
      down_driver: down,
      reassigned: [],
      unassignable: [],
      summary: {
        pending_taken: 0,
        distributed_to_drivers: 0,
        total_delta_km: 0,
        confidence: 1
      }
    };
  }

  // 排序：planned_arrival_at 早的優先（時間窗緊）；無 planned 的次之
  pendingPool.sort((a, b) => {
    const ta = a.planned_arrival_at ? new Date(a.planned_arrival_at).getTime() : Infinity;
    const tb = b.planned_arrival_at ? new Date(b.planned_arrival_at).getTime() : Infinity;
    return ta - tb;
  });

  // 候選 driver = 其他人 — 排除 down 自己
  const candidates = snap.drivers.filter((d) => d.driver_id !== down.driver_id && d.task_id);

  // 抓所有候選 driver 的 pending stops（用於計算 cheapest-insertion 的「目前 path」）
  const candidateTaskIds = candidates.map((d) => d.task_id!).filter((x): x is string => !!x);
  const { data: allStops } = candidateTaskIds.length === 0
    ? { data: [] }
    : await admin
      .from("delivery_task_stops")
      .select(
        "id, delivery_task_id, stop_id, stop_order, status, " +
          "stop:stops(lat, lng, temperature_type, avg_delivery_volume)"
      )
      .in("delivery_task_id", candidateTaskIds)
      .order("stop_order", { ascending: true })
      .returns<Array<{
        id: string; delivery_task_id: string; stop_id: string;
        stop_order: number; status: string;
        stop: {
          lat: number | null; lng: number | null;
          temperature_type: string | null;
          avg_delivery_volume: number | null;
        } | Array<{
          lat: number | null; lng: number | null;
          temperature_type: string | null;
          avg_delivery_volume: number | null;
        }> | null;
      }>>();
  const candidateStopMap = new Map<string, Array<{
    id: string;
    lat: number;
    lng: number;
    status: string;
    demand: number;
    temperature: string | null;
  }>>();
  for (const t of candidates) {
    if (!t.task_id) continue;
    const own = (allStops ?? []).filter((s) => s.delivery_task_id === t.task_id);
    candidateStopMap.set(t.task_id, own
      .map((s) => {
        const st = pickFirst(s.stop);
        if (st?.lat == null || st?.lng == null) return null;
        return {
          id: s.id,
          lat: Number(st.lat),
          lng: Number(st.lng),
          status: s.status,
          demand: st.avg_delivery_volume ?? 0,
          temperature: st.temperature_type ?? null
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null));
  }

  // 處理每個 pending stop
  const reassigned: ReassignedStop[] = [];
  const unassignable: ReassignedStop[] = [];
  let totalDelta = 0;
  const driversTouched = new Set<string>();

  // 計算每個候選 driver 的目前「總用箱數」，避免邊跑邊重新查
  const driverUsed = new Map<string, number>();
  for (const c of candidates) {
    if (!c.task_id) continue;
    const own = candidateStopMap.get(c.task_id) ?? [];
    driverUsed.set(c.driver_id, own.reduce((s, x) => s + x.demand, 0));
  }

  for (const stop of pendingPool) {
    const stopMeta = pickFirst(stop.stop);
    if (!stopMeta?.lat || !stopMeta?.lng) {
      unassignable.push({
        task_stop_id: stop.id,
        stop_id: stop.stop_id,
        stop_name: stopMeta?.external_code ? `${stopMeta.external_code} ${stopMeta.name}` : (stopMeta?.name ?? stop.stop_id),
        from_driver_id: down.driver_id,
        from_driver_name: down.driver_name,
        to_driver_id: null,
        to_driver_name: null,
        insertion_after_index: null,
        delta_km: 0,
        reason: "—",
        unassign_reason: "停靠點缺 lat/lng"
      });
      continue;
    }
    const stopPos: LatLng = { lat: Number(stopMeta.lat), lng: Number(stopMeta.lng) };
    const demand = stopMeta.avg_delivery_volume ?? 0;
    const tempReq = stopMeta.temperature_type ?? "ambient";
    const shiftReq = stopMeta.shift ?? null;

    // 對每個 candidate 計算
    let best: {
      driver: DriverSnapshot;
      delta_km: number;
      after_index: number;
      reason: string;
    } | null = null;

    for (const c of candidates) {
      // 班別不符 → skip
      if (shiftReq && c.shift && c.shift !== shiftReq) continue;
      // 溫層不符 → skip
      if (!c.temperature_capability.includes(tempReq) && !c.temperature_capability.includes("mixed")) continue;
      // 容量不足 → skip
      const used = driverUsed.get(c.driver_id) ?? 0;
      if (used + demand > c.vehicle_capacity) continue;

      // cheapest-insertion path
      const own = candidateStopMap.get(c.task_id!) ?? [];
      const pending = own.filter((s) => s.status === "pending" || s.status === "navigating");
      const lastDone = [...own].reverse().find((s) => s.status === "completed" || s.status === "arrived");

      const path: LatLng[] = [];
      if (lastDone) path.push({ lat: lastDone.lat, lng: lastDone.lng });
      else if (c.current_lat && c.current_lng) path.push({ lat: c.current_lat, lng: c.current_lng });
      else path.push({ lat: 25.0610, lng: 121.4847 }); // depot
      for (const p of pending) path.push({ lat: p.lat, lng: p.lng });

      // 找最便宜插入位置
      let bestDelta = Infinity;
      let bestIdx = 0;
      for (let i = 0; i < path.length; i++) {
        const before = path[i];
        const after = i + 1 < path.length ? path[i + 1] : null;
        const dBA = after ? haversineMeters(before, after) : 0;
        const dBN = haversineMeters(before, stopPos);
        const dNA = after ? haversineMeters(stopPos, after) : 0;
        const delta = dBN + dNA - dBA;
        if (delta < bestDelta) {
          bestDelta = delta;
          bestIdx = i;
        }
      }

      // 評分: delta + 已 pending 數 *  100m 懲罰（鼓勵分散）
      const pendingPenalty = pending.length * 100;
      const score = bestDelta + pendingPenalty;

      if (!best || score < best.delta_km + (best.driver.pending_stops * 100)) {
        const why: string[] = [];
        if (bestDelta < 2000) why.push(`插入僅多繞 ${(bestDelta / 1000).toFixed(1)} km`);
        if (pending.length < 5) why.push(`pending 較少 (${pending.length})`);
        if (used + demand < c.vehicle_capacity * 0.6) why.push("容量充裕");
        best = {
          driver: c,
          delta_km: bestDelta / 1000,
          after_index: bestIdx,
          reason: why.join(" · ") || "符合所有約束"
        };
      }
    }

    if (!best) {
      unassignable.push({
        task_stop_id: stop.id,
        stop_id: stop.stop_id,
        stop_name: stopMeta?.external_code ? `${stopMeta.external_code} ${stopMeta.name}` : stopMeta.name,
        from_driver_id: down.driver_id,
        from_driver_name: down.driver_name,
        to_driver_id: null,
        to_driver_name: null,
        insertion_after_index: null,
        delta_km: 0,
        reason: "—",
        unassign_reason: "無人符合班別 / 溫層 / 容量"
      });
      continue;
    }

    reassigned.push({
      task_stop_id: stop.id,
      stop_id: stop.stop_id,
      stop_name: stopMeta.external_code ? `${stopMeta.external_code} ${stopMeta.name}` : stopMeta.name,
      from_driver_id: down.driver_id,
      from_driver_name: down.driver_name,
      to_driver_id: best.driver.driver_id,
      to_driver_name: best.driver.driver_name,
      insertion_after_index: best.after_index,
      delta_km: best.delta_km,
      reason: best.reason,
      unassign_reason: null
    });
    totalDelta += best.delta_km;
    driversTouched.add(best.driver.driver_id);
    // 把這 stop 加進該 driver 的 candidateStopMap 末尾，影響後續 stop 的計算（greedy）
    const cur = candidateStopMap.get(best.driver.task_id!) ?? [];
    cur.push({
      id: stop.id,
      lat: stopPos.lat,
      lng: stopPos.lng,
      status: "pending",
      demand,
      temperature: tempReq
    });
    candidateStopMap.set(best.driver.task_id!, cur);
    driverUsed.set(best.driver.driver_id, (driverUsed.get(best.driver.driver_id) ?? 0) + demand);
  }

  // confidence: 重派比例 + delta 合理性
  const totalTaken = pendingPool.length;
  const reassignedRatio = totalTaken === 0 ? 1 : reassigned.length / totalTaken;
  const avgDelta = reassigned.length === 0 ? 0 : totalDelta / reassigned.length;
  const deltaScore = avgDelta < 3 ? 1 : avgDelta < 8 ? 0.7 : avgDelta < 15 ? 0.5 : 0.3;
  const confidence = Math.round((reassignedRatio * 0.6 + deltaScore * 0.4) * 100) / 100;

  return {
    date: snap.date,
    down_driver: down,
    reassigned,
    unassignable,
    summary: {
      pending_taken: pendingPool.length,
      distributed_to_drivers: driversTouched.size,
      total_delta_km: Math.round(totalDelta * 10) / 10,
      confidence
    }
  };
}

// ─────────────────────────────────────────────────────────────
// Apply reroute (writes to DB)
// ─────────────────────────────────────────────────────────────
export async function applyReroute(plan: ReroutePlan): Promise<{ moved: number; skipped: number }> {
  const admin = createSupabaseAdminClient();
  let moved = 0;
  let skipped = 0;

  for (const r of plan.reassigned) {
    if (!r.to_driver_id) { skipped++; continue; }

    // 找新 driver 的 task_id
    const newDriver = plan.down_driver.driver_id === r.to_driver_id ? null : null; // 不會發生
    void newDriver;
    // 用 down driver_id 是錯的 — 我們要從 snapshot 找 to_driver_id 對應的 task_id
    // 但 plan 沒帶 to_driver task_id；改抓
    const { data: targetTask } = await admin
      .from("delivery_tasks")
      .select("id")
      .eq("driver_id", r.to_driver_id)
      .eq("delivery_date", plan.date)
      .maybeSingle<{ id: string }>();
    if (!targetTask) { skipped++; continue; }

    // 找新 driver 目前最大 stop_order
    const { data: maxRow } = await admin
      .from("delivery_task_stops")
      .select("stop_order")
      .eq("delivery_task_id", targetTask.id)
      .order("stop_order", { ascending: false })
      .limit(1)
      .maybeSingle<{ stop_order: number }>();
    const nextOrder = (maxRow?.stop_order ?? 0) + 1;

    // 更新原 task_stop：搬到新 task + 新 stop_order + 重設狀態 pending
    const { error } = await admin
      .from("delivery_task_stops")
      .update({
        delivery_task_id: targetTask.id,
        stop_order: nextOrder,
        status: "pending",
        actual_arrival_at: null,
        completed_at: null,
        store_checkin_at: null,
        uploaded_at: null,
        confirmed_at: null
      })
      .eq("id", r.task_stop_id);
    if (error) {
      console.error("[emergency-apply] update failed", error.message);
      skipped++;
      continue;
    }
    moved++;
  }

  // down driver 的 task 狀態改成 cancelled（pending stops 已搬走）
  if (plan.down_driver.task_id) {
    await admin
      .from("delivery_tasks")
      .update({ status: "cancelled" })
      .eq("id", plan.down_driver.task_id);
  }

  return { moved, skipped };
}

// ─────────────────────────────────────────────────────────────
// Per-stop 重派（給「重新派遣方案 → 選擇物流士 / AI 派遣建議」用）
// ─────────────────────────────────────────────────────────────

export interface PendingStopRow {
  task_stop_id: string;
  stop_id: string;
  stop_name: string;
  stop_external_code: string | null;
  stop_address: string | null;
  lat: number | null;
  lng: number | null;
  demand_boxes: number;
  temperature: string | null;
  preferred_shift: string | null;
  stop_order: number;
  planned_arrival_at: string | null;
  service_minutes: number | null;
}

/** 撈某 driver 今日（或指定日期）所有 pending / navigating 的 task_stops，給 UI 列表用 */
export async function getDriverPendingStops(opts: {
  driver_id: string;
  date?: string;
}): Promise<{ date: string; driver_id: string; stops: PendingStopRow[] }> {
  const admin = createSupabaseAdminClient();
  const date = opts.date ?? todayInTaipei();

  const { data: task } = await admin
    .from("delivery_tasks")
    .select("id")
    .eq("driver_id", opts.driver_id)
    .eq("delivery_date", date)
    .maybeSingle<{ id: string }>();
  if (!task) return { date, driver_id: opts.driver_id, stops: [] };

  const { data: rows } = await admin
    .from("delivery_task_stops")
    .select(
      "id, stop_id, stop_order, status, planned_arrival_at, " +
        "stop:stops(name, external_code, address, lat, lng, temperature_type, " +
        "shift, avg_delivery_volume, default_service_minutes)"
    )
    .eq("delivery_task_id", task.id)
    .in("status", ["pending", "navigating"])
    .order("stop_order", { ascending: true })
    .returns<TaskStopRow[]>();

  const stops: PendingStopRow[] = (rows ?? []).map((r) => {
    const s = pickFirst(r.stop);
    return {
      task_stop_id: r.id,
      stop_id: r.stop_id,
      stop_name: s?.name ?? r.stop_id,
      stop_external_code: s?.external_code ?? null,
      stop_address: (s as { address?: string | null } | null)?.address ?? null,
      lat: s?.lat ?? null,
      lng: s?.lng ?? null,
      demand_boxes: s?.avg_delivery_volume ?? 0,
      temperature: s?.temperature_type ?? null,
      preferred_shift: s?.shift ?? null,
      stop_order: r.stop_order,
      planned_arrival_at: r.planned_arrival_at,
      service_minutes: s?.default_service_minutes ?? null
    };
  });

  return { date, driver_id: opts.driver_id, stops };
}

export interface StopMoveCandidate {
  driver_id: string;
  driver_name: string;
  employee_code: string | null;
  score: number;
  rank: number;
  reason: string;
  details: {
    distance_km: number;
    remaining_capacity: number;
    shift_match: boolean;
    temperature_match: boolean;
    pending_stops: number;
    last_known_position: { lat: number; lng: number } | null;
  };
  insertion_delta_km: number;
  insertion_after_index: number;
}

/**
 * 給定一個 task_stop_id，算出其他 driver 接這站的候選清單與分數
 * （與急件派遣的 scoring 完全一樣，差別只是來源不是 in-memory 急件 store）
 */
export async function suggestDriversForStop(opts: {
  task_stop_id: string;
  /** 要排除的 driver（通常是 down driver 自己） */
  exclude_driver_id: string;
  date?: string;
}): Promise<{
  stop: PendingStopRow & { from_driver_id: string };
  candidates: StopMoveCandidate[];
  context: { drivers_evaluated: number; date: string };
}> {
  const admin = createSupabaseAdminClient();
  const date = opts.date ?? todayInTaipei();

  // 找這個 task_stop 屬於哪個 task / driver / 哪個 stop
  const { data: tsRow } = await admin
    .from("delivery_task_stops")
    .select(
      "id, stop_id, stop_order, planned_arrival_at, delivery_task_id, " +
        "task:delivery_tasks(driver_id), " +
        "stop:stops(name, external_code, address, lat, lng, temperature_type, " +
        "shift, avg_delivery_volume, default_service_minutes)"
    )
    .eq("id", opts.task_stop_id)
    .maybeSingle<{
      id: string; stop_id: string; stop_order: number;
      planned_arrival_at: string | null; delivery_task_id: string;
      task: { driver_id: string } | Array<{ driver_id: string }> | null;
      stop: TaskStopRow["stop"];
    }>();
  if (!tsRow) throw new Error(`task_stop ${opts.task_stop_id} not found`);
  const meta = pickFirst(tsRow.stop);
  const fromDriverId = pickFirst(tsRow.task)?.driver_id ?? opts.exclude_driver_id;
  if (meta?.lat == null || meta?.lng == null) {
    throw new Error("該站無經緯度，無法估算距離");
  }
  const stopRow: PendingStopRow & { from_driver_id: string } = {
    task_stop_id: tsRow.id,
    stop_id: tsRow.stop_id,
    stop_name: meta.name,
    stop_external_code: meta.external_code,
    stop_address: (meta as { address?: string | null }).address ?? null,
    lat: meta.lat,
    lng: meta.lng,
    demand_boxes: meta.avg_delivery_volume ?? 0,
    temperature: meta.temperature_type,
    preferred_shift: meta.shift,
    stop_order: tsRow.stop_order,
    planned_arrival_at: tsRow.planned_arrival_at,
    service_minutes: meta.default_service_minutes,
    from_driver_id: fromDriverId
  };

  // 取所有 active drivers（排除自己）+ 每位 driver 今日的 pending stops（用於算 capacity / load）
  const { data: driversRaw } = await admin
    .from("profiles")
    .select(
      "id, full_name, employee_code, shift, vehicle_capacity, temperature_capability, is_active"
    )
    .eq("role", "driver")
    .eq("is_active", true)
    .neq("id", opts.exclude_driver_id);
  const drivers = (driversRaw ?? []) as Array<{
    id: string; full_name: string; employee_code: string | null;
    shift: string | null; vehicle_capacity: number | null;
    temperature_capability: string | null; is_active: boolean;
  }>;

  const { data: tasks } = await admin
    .from("delivery_tasks")
    .select("id, driver_id")
    .eq("delivery_date", date)
    .in("driver_id", drivers.map((d) => d.id));
  const taskByDriver = new Map<string, string>();
  for (const t of (tasks ?? []) as Array<{ id: string; driver_id: string }>) {
    taskByDriver.set(t.driver_id, t.id);
  }
  const taskIds = Array.from(taskByDriver.values());
  interface OwnStopRow {
    delivery_task_id: string;
    status: string;
    stop: { lat: number | null; lng: number | null; avg_delivery_volume: number | null }
          | Array<{ lat: number | null; lng: number | null; avg_delivery_volume: number | null }>
          | null;
  }
  let ownStops: OwnStopRow[] = [];
  if (taskIds.length > 0) {
    const { data } = await admin
      .from("delivery_task_stops")
      .select(
        "id, delivery_task_id, status, " +
          "stop:stops(lat, lng, avg_delivery_volume)"
      )
      .in("delivery_task_id", taskIds)
      .returns<OwnStopRow[]>();
    ownStops = data ?? [];
  }

  // 算每位 driver 的：last known position + capacity used + pending stops 數 + 距離
  const candidates: StopMoveCandidate[] = [];
  const W_DIST = 0.35, W_CAP = 0.15, W_SHIFT = 0.15, W_TEMP = 0.15,
        W_LOAD = 0.15, W_PRIO = 0.05;
  const DEPOT = { lat: 25.0610, lng: 121.4847 };

  for (const d of drivers) {
    const taskId = taskByDriver.get(d.id);
    const owns = ownStops.filter((s) => s.delivery_task_id === taskId);
    const pending = owns.filter((s) => s.status === "pending" || s.status === "navigating");
    const lastCompleted = [...owns].reverse().find(
      (s) => s.status === "completed" || s.status === "arrived"
    );
    let lastPos: { lat: number; lng: number } = DEPOT;
    if (lastCompleted) {
      const ls = pickFirst(lastCompleted.stop);
      if (ls?.lat && ls?.lng) lastPos = { lat: ls.lat, lng: ls.lng };
    } else if (pending.length > 0) {
      const ps = pickFirst(pending[0].stop);
      if (ps?.lat && ps?.lng) lastPos = { lat: ps.lat, lng: ps.lng };
    }
    const distKm = haversineMeters(lastPos, { lat: stopRow.lat!, lng: stopRow.lng! }) / 1000;

    const usedBoxes = owns.reduce((s, x) => {
      const sm = pickFirst(x.stop);
      return s + (sm?.avg_delivery_volume ?? 0);
    }, 0);
    const totalCap = d.vehicle_capacity ?? 250;  // 對齊 OR_new MVP seed
    const remaining = Math.max(0, totalCap - usedBoxes);

    const shiftOk = !stopRow.preferred_shift || !d.shift || d.shift === stopRow.preferred_shift;
    const caps = (d.temperature_capability ?? "ambient,mixed,chilled,frozen").split(",").map((x) => x.trim());
    const tempOk = !stopRow.temperature || caps.includes(stopRow.temperature) || caps.includes("mixed");

    // 簡易 insertion delta
    let insertionDelta = 0;
    let insertionIdx = 0;
    if (pending.length === 0) {
      insertionDelta = 2 * haversineMeters(lastPos, { lat: stopRow.lat!, lng: stopRow.lng! }) / 1000;
    } else {
      let best = Infinity, bestIdx = 0;
      const path = [lastPos, ...pending.map((p) => {
        const ps = pickFirst(p.stop);
        return ps?.lat && ps?.lng ? { lat: ps.lat, lng: ps.lng } : null;
      }).filter((x): x is LatLng => x !== null)];
      for (let i = 0; i < path.length; i++) {
        const before = path[i];
        const after = i + 1 < path.length ? path[i + 1] : null;
        const dBA = after ? haversineMeters(before, after) : 0;
        const dBN = haversineMeters(before, { lat: stopRow.lat!, lng: stopRow.lng! });
        const dNA = after ? haversineMeters({ lat: stopRow.lat!, lng: stopRow.lng! }, after) : 0;
        const delta = (dBN + dNA - dBA) / 1000;
        if (delta < best) { best = delta; bestIdx = i; }
      }
      insertionDelta = best;
      insertionIdx = bestIdx;
    }

    const distScore = Math.max(0, 1 - distKm / 30);
    const capScore = remaining >= stopRow.demand_boxes ? remaining / Math.max(1, totalCap) : 0;
    const shiftScore = shiftOk ? 1 : 0;
    const tempScore = tempOk ? 1 : 0;
    const loadScore = Math.max(0, 1 - pending.length / 30);
    const score =
      W_DIST * distScore + W_CAP * capScore + W_SHIFT * shiftScore +
      W_TEMP * tempScore + W_LOAD * loadScore + W_PRIO * 0.3;

    const reasonParts: string[] = [];
    if (distScore > 0.7) reasonParts.push(`距離近 (${distKm.toFixed(1)} km)`);
    else if (distScore < 0.3) reasonParts.push(`距離較遠 (${distKm.toFixed(1)} km)`);
    if (capScore === 0 && stopRow.demand_boxes > remaining)
      reasonParts.push(`容量不足 (剩 ${remaining}/${totalCap})`);
    else if (capScore > 0.6) reasonParts.push(`容量充裕 (剩 ${remaining}/${totalCap})`);
    if (!shiftOk) reasonParts.push("班別不符");
    if (!tempOk) reasonParts.push("溫層不符");
    if (insertionDelta < 5) reasonParts.push(`插入僅 ${insertionDelta.toFixed(1)} km`);

    candidates.push({
      driver_id: d.id,
      driver_name: d.full_name,
      employee_code: d.employee_code,
      score, rank: 0,
      reason: reasonParts.join(" · ") || "標準候選",
      details: {
        distance_km: distKm,
        remaining_capacity: remaining,
        shift_match: shiftOk,
        temperature_match: tempOk,
        pending_stops: pending.length,
        last_known_position: lastPos
      },
      insertion_delta_km: insertionDelta,
      insertion_after_index: insertionIdx
    });
  }

  candidates.sort((a, b) => {
    if (a.details.remaining_capacity < stopRow.demand_boxes && b.details.remaining_capacity >= stopRow.demand_boxes) return 1;
    if (a.details.remaining_capacity >= stopRow.demand_boxes && b.details.remaining_capacity < stopRow.demand_boxes) return -1;
    if (!a.details.temperature_match && b.details.temperature_match) return 1;
    if (a.details.temperature_match && !b.details.temperature_match) return -1;
    return b.score - a.score;
  });
  for (let i = 0; i < candidates.length; i++) candidates[i].rank = i + 1;

  return {
    stop: stopRow,
    candidates,
    context: { drivers_evaluated: candidates.length, date }
  };
}

/** 把指定 task_stop 移到目標 driver 今日的 task；目標 task 不存在則自動建。 */
export async function moveStopToDriver(opts: {
  task_stop_id: string;
  target_driver_id: string;
  date?: string;
}): Promise<{ moved: true; new_task_id: string; insertion_position: number }> {
  const admin = createSupabaseAdminClient();
  const date = opts.date ?? todayInTaipei();

  // 找目標 driver 今日 task；沒有就建一個
  const { data: existing } = await admin
    .from("delivery_tasks")
    .select("id")
    .eq("driver_id", opts.target_driver_id)
    .eq("delivery_date", date)
    .maybeSingle<{ id: string }>();
  let targetTaskId: string;
  if (existing) {
    targetTaskId = existing.id;
  } else {
    const { data: created, error } = await admin
      .from("delivery_tasks")
      .insert({
        driver_id: opts.target_driver_id,
        delivery_date: date,
        status: "pending"
      })
      .select("id")
      .single();
    if (error || !created) throw error ?? new Error("Failed to create target task");
    targetTaskId = created.id;
  }

  // 算 next stop_order
  const { data: maxRow } = await admin
    .from("delivery_task_stops")
    .select("stop_order")
    .eq("delivery_task_id", targetTaskId)
    .order("stop_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ stop_order: number }>();
  const nextOrder = (maxRow?.stop_order ?? 0) + 1;

  // 搬遷
  const { error: updErr } = await admin
    .from("delivery_task_stops")
    .update({
      delivery_task_id: targetTaskId,
      stop_order: nextOrder,
      status: "pending",
      actual_arrival_at: null,
      completed_at: null,
      store_checkin_at: null,
      uploaded_at: null,
      confirmed_at: null
    })
    .eq("id", opts.task_stop_id);
  if (updErr) throw updErr;

  return { moved: true, new_task_id: targetTaskId, insertion_position: nextOrder };
}

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
      vehicle_capacity: d?.vehicle_capacity ?? 60,
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

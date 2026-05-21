import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  generateUrgentId, listUrgent, upsertUrgent, getUrgent,
  type UrgentShipment, type UrgentPriority
} from "./urgent-store";
import { haversineMeters } from "./or/kernel/distance";

/**
 * 急件派遣服務 — AI 評分 + 落地寫進 delivery_task_stops。
 *
 * 流程：
 *   1. POST /api/manager/urgent/mock  → 從 stops 主檔抽 5 件當「急件」（in-memory）
 *   2. POST /api/manager/urgent/:id/dispatch  → AI 排候選 driver 給主管選
 *   3. POST /api/manager/urgent/:id/apply   → 把急件 cheapest-insertion 插進該 driver 今日 task
 *
 * AI 評分公式（rule-based，可解釋）：
 *   score = w_distance * (1 - normalized_distance)
 *         + w_capacity * (remaining_capacity_ratio)
 *         + w_shift    * shift_match
 *         + w_temp     * temperature_match
 *         + w_load     * (1 - normalized_pending_load)
 *         + w_priority * urgency_bonus
 */

const W_DISTANCE = 0.35;
const W_CAPACITY = 0.15;
const W_SHIFT    = 0.15;
const W_TEMP     = 0.15;
const W_LOAD     = 0.15;
const W_PRIORITY = 0.05;

interface StopMaster {
  id: string;
  external_code: string | null;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  shift: string | null;
  temperature_type: string | null;
  avg_delivery_volume: number | null;
  default_service_minutes: number | null;
}

interface DriverProfile {
  id: string;
  full_name: string;
  employee_code: string | null;
  shift: string | null;
  vehicle_capacity: number | null;
  temperature_capability: string | null;
  is_active: boolean;
}

interface TaskRow {
  id: string;
  driver_id: string;
  status: string;
  driver_route_assignment_id: string | null;
}

interface TaskStopRow {
  id: string;
  delivery_task_id: string;
  stop_id: string;
  stop_order: number;
  status: string;
  // delivery_task_stops 自身沒有預估欄位；用 stops 主檔上的 default_service_minutes / avg_delivery_volume 推算
  stop: {
    lat: number | null;
    lng: number | null;
    default_service_minutes: number | null;
    avg_delivery_volume: number | null;
  } | Array<{
    lat: number | null;
    lng: number | null;
    default_service_minutes: number | null;
    avg_delivery_volume: number | null;
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
// 1. Mock 急件產生器
// ─────────────────────────────────────────────────────────────
export async function generateMockUrgentShipments(opts: {
  count?: number;
  seed?: number;
}): Promise<UrgentShipment[]> {
  const admin = createSupabaseAdminClient();
  const count = opts.count ?? 5;
  const { data: stops } = await admin
    .from("stops")
    .select(
      "id, external_code, name, address, lat, lng, shift, temperature_type, " +
        "avg_delivery_volume, default_service_minutes"
    )
    .eq("is_active", true)
    .not("lat", "is", null)
    .not("lng", "is", null)
    .returns<StopMaster[]>();

  const pool = (stops ?? []).filter((s) => s.lat && s.lng);
  if (pool.length === 0) {
    throw new Error("沒有可用的 stops 主檔（需先有 lat/lng 不為 null 的 active stop）");
  }

  // Deterministic shuffle by seed
  const seed = opts.seed ?? Math.floor(Date.now() / 60000);
  const shuffled = [...pool].sort((a, b) => {
    const ha = stableHash(a.id + seed);
    const hb = stableHash(b.id + seed);
    return ha - hb;
  });
  const picks = shuffled.slice(0, Math.min(count, pool.length));

  const priorities: UrgentPriority[] = ["p0_critical", "p1_high", "p1_high", "p2_normal", "p2_normal"];
  const sources = ["VIP 客戶手機通報", "客服中心電話", "業務代下單", "API 系統推送", "門市直接聯繫"];
  const notesPool = [
    "客戶午餐尖峰前要到貨",
    "週末 BBQ 大單，務必準時",
    "新門市開幕日，需提早送達",
    "原批貨少送 12 箱，補件",
    "凍品溫度回升，需要 1 小時內到場",
    "VIP 高層拜訪，務必早於 11:00 完成"
  ];

  const out: UrgentShipment[] = [];
  for (let i = 0; i < picks.length; i++) {
    const s = picks[i];
    const seedI = stableHash(s.id + seed + i);
    const priority = priorities[seedI % priorities.length];
    const id = generateUrgentId();
    const item: UrgentShipment = {
      id,
      stop_id: s.id,
      stop_name: s.external_code ? `${s.external_code} ${s.name}` : s.name,
      stop_address: s.address ?? "",
      lat: Number(s.lat),
      lng: Number(s.lng),
      demand_boxes: (s.avg_delivery_volume ?? 5) + ((seedI % 6) - 2),
      temperature: s.temperature_type ?? "ambient",
      preferred_shift: (s.shift as "day" | "night" | null) ?? "any",
      priority,
      deadline_hm: priority === "p0_critical"
        ? hourFromNow(2)
        : priority === "p1_high"
          ? hourFromNow(4)
          : null,
      source: sources[seedI % sources.length],
      notes: notesPool[seedI % notesPool.length],
      status: "pending",
      assigned_driver_id: null,
      assigned_driver_name: null,
      dispatch_meta: null,
      created_at: new Date().toISOString(),
      assigned_at: null
    };
    upsertUrgent(item);
    out.push(item);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 2. AI 派遣評分
// ─────────────────────────────────────────────────────────────
export interface DriverCandidate {
  driver_id: string;
  driver_name: string;
  employee_code: string | null;
  score: number;
  rank: number;
  /** 為什麼這個分數（人話） */
  reason: string;
  details: {
    distance_km: number;
    remaining_capacity: number;
    shift_match: boolean;
    temperature_match: boolean;
    pending_stops: number;
    last_known_position: { lat: number; lng: number } | null;
  };
  /** 急件插進此 driver 預估 Δkm（用 cheapest-insertion 估） */
  insertion_delta_km: number;
  /** 插入位置：在第 N 個 pending stop 之後 */
  insertion_after_index: number;
}

export async function suggestUrgentDispatch(urgentId: string): Promise<{
  urgent: UrgentShipment;
  candidates: DriverCandidate[];
  context: { drivers_evaluated: number; date: string };
}> {
  const u = getUrgent(urgentId);
  if (!u) throw new Error(`Urgent shipment ${urgentId} not found`);
  if (u.status !== "pending") throw new Error(`Urgent shipment ${urgentId} 已處理過，狀態=${u.status}`);

  const admin = createSupabaseAdminClient();
  const today = todayInTaipei();

  // a) 所有 active drivers
  const { data: driversRaw } = await admin
    .from("profiles")
    .select(
      "id, full_name, employee_code, shift, vehicle_capacity, " +
        "temperature_capability, is_active"
    )
    .eq("role", "driver")
    .eq("is_active", true)
    .returns<DriverProfile[]>();
  const drivers = driversRaw ?? [];

  // b) 今日 tasks 對應的 stops（找出每位 driver 已派的 pending stops + 已完成 stops）
  // 抓「最近一天」當 fallback，避免 demo 環境沒今天 task
  const todayTasksRes = await admin
    .from("delivery_tasks")
    .select("id, driver_id, status, driver_route_assignment_id")
    .eq("delivery_date", today)
    .returns<TaskRow[]>();
  let tasks = todayTasksRes.data ?? [];
  if (tasks.length === 0) {
    // dev fallback：最近一天
    const { data: latestDate } = await admin
      .from("delivery_tasks")
      .select("delivery_date")
      .order("delivery_date", { ascending: false })
      .limit(1)
      .maybeSingle<{ delivery_date: string }>();
    if (latestDate?.delivery_date) {
      const { data } = await admin
        .from("delivery_tasks")
        .select("id, driver_id, status, driver_route_assignment_id")
        .eq("delivery_date", latestDate.delivery_date)
        .returns<TaskRow[]>();
      tasks = data ?? [];
    }
  }

  const taskByDriver = new Map<string, TaskRow>();
  for (const t of tasks) taskByDriver.set(t.driver_id, t);

  const taskIds = tasks.map((t) => t.id);
  const stopRows: TaskStopRow[] = taskIds.length === 0 ? [] : (
    (await admin
      .from("delivery_task_stops")
      .select(
        "id, delivery_task_id, stop_id, stop_order, status, " +
          "stop:stops(lat, lng, default_service_minutes, avg_delivery_volume)"
      )
      .in("delivery_task_id", taskIds)
      .order("stop_order", { ascending: true })
      .returns<TaskStopRow[]>()).data ?? []
  );

  // c) 對每位 driver 算分
  const evals: DriverCandidate[] = [];
  for (const d of drivers) {
    const t = taskByDriver.get(d.id);
    const ownStops = t ? stopRows.filter((s) => s.delivery_task_id === t.id) : [];
    const pending = ownStops.filter((s) => s.status === "pending" || s.status === "navigating");
    const lastCompleted = [...ownStops].reverse().find((s) => s.status === "completed" || s.status === "arrived");

    // distance from「最近的可知位置」到急件
    let lastPos: { lat: number; lng: number } | null = null;
    if (lastCompleted) {
      const ls = pickFirst(lastCompleted.stop);
      if (ls?.lat && ls?.lng) lastPos = { lat: ls.lat, lng: ls.lng };
    }
    if (!lastPos && pending.length > 0) {
      const ps = pickFirst(pending[0].stop);
      if (ps?.lat && ps?.lng) lastPos = { lat: ps.lat, lng: ps.lng };
    }
    if (!lastPos) {
      lastPos = { lat: 25.0610, lng: 121.4847 }; // depot fallback
    }

    const distKm = haversineMeters(lastPos, { lat: u.lat, lng: u.lng }) / 1000;

    // 容量分析（從 stops 主檔的 avg_delivery_volume 推算）
    const usedBoxes = ownStops.reduce((s, x) => {
      const sm = pickFirst(x.stop);
      return s + (sm?.avg_delivery_volume ?? 0);
    }, 0);
    const totalCap = d.vehicle_capacity ?? 60;
    const remaining = Math.max(0, totalCap - usedBoxes);
    const remainingRatio = remaining / Math.max(1, totalCap);

    // shift match
    const shiftOk = u.preferred_shift === "any" || !d.shift || d.shift === u.preferred_shift;

    // temperature match (driver.temperature_capability 是 csv 或 single 值)
    const caps = (d.temperature_capability ?? "ambient,mixed,chilled,frozen").split(",").map((x) => x.trim());
    const tempOk = caps.includes(u.temperature) || caps.includes("mixed");

    // 預估插入 Δ — 用 cheapest-insertion 估
    let insertionDelta = 0;
    let insertionIdx = 0;
    if (pending.length === 0) {
      // 沒 pending，直接從 lastPos 來回急件
      insertionDelta = (haversineMeters(lastPos, { lat: u.lat, lng: u.lng })
        + haversineMeters({ lat: u.lat, lng: u.lng }, lastPos)) / 1000;
      insertionIdx = 0;
    } else {
      // 嘗試每個 pending 位置間
      let best = Infinity;
      let bestIdx = 0;
      // [lastPos] → p0 → p1 → ... → pN  路徑中插入 urgent
      const path = [lastPos, ...pending.map((p) => {
        const s = pickFirst(p.stop);
        return s?.lat && s?.lng ? { lat: s.lat, lng: s.lng } : null;
      }).filter((x) => x !== null) as Array<{ lat: number; lng: number }>];
      for (let i = 0; i < path.length; i++) {
        const before = path[i];
        const after = i + 1 < path.length ? path[i + 1] : null;
        const dBA = after ? haversineMeters(before, after) : 0;
        const dBN = haversineMeters(before, { lat: u.lat, lng: u.lng });
        const dNA = after ? haversineMeters({ lat: u.lat, lng: u.lng }, after) : 0;
        const delta = (dBN + dNA - dBA) / 1000;
        if (delta < best) {
          best = delta;
          bestIdx = i;
        }
      }
      insertionDelta = best;
      insertionIdx = bestIdx;
    }

    // 評分 — 用 0..1 normalized
    const distScore   = Math.max(0, 1 - distKm / 30);          // 30km 為 0 分
    const capScore    = remaining >= u.demand_boxes ? remainingRatio : 0;
    const shiftScore  = shiftOk ? 1 : 0;
    const tempScore   = tempOk ? 1 : 0;
    const loadScore   = Math.max(0, 1 - pending.length / 30);  // 30 站為 0 分
    const priorityBonus =
      u.priority === "p0_critical" ? 1 : u.priority === "p1_high" ? 0.6 : 0.3;

    const score =
      W_DISTANCE * distScore +
      W_CAPACITY * capScore +
      W_SHIFT    * shiftScore +
      W_TEMP     * tempScore +
      W_LOAD     * loadScore +
      W_PRIORITY * priorityBonus;

    // 人話 reason
    const reasonParts: string[] = [];
    if (distScore > 0.7) reasonParts.push(`距離近 (${distKm.toFixed(1)} km)`);
    else if (distScore < 0.3) reasonParts.push(`距離較遠 (${distKm.toFixed(1)} km)`);
    if (capScore === 0 && u.demand_boxes > remaining)
      reasonParts.push(`容量不足 (剩 ${remaining}/${totalCap})`);
    else if (capScore > 0.6) reasonParts.push(`容量充裕 (剩 ${remaining}/${totalCap})`);
    if (!shiftOk) reasonParts.push(`班別不符 (要求 ${u.preferred_shift})`);
    if (!tempOk) reasonParts.push(`溫層不符 (要求 ${u.temperature})`);
    if (pending.length === 0) reasonParts.push("今日已無待跑站，可全速接單");
    else if (pending.length > 20) reasonParts.push(`已有 ${pending.length} 站 pending`);
    if (insertionDelta < 5) reasonParts.push(`插入後僅多繞 ${insertionDelta.toFixed(1)} km`);
    else if (insertionDelta > 15) reasonParts.push(`插入後多繞 ${insertionDelta.toFixed(1)} km`);

    evals.push({
      driver_id: d.id,
      driver_name: d.full_name,
      employee_code: d.employee_code,
      score,
      rank: 0, // 後面再 fill
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

  // 排名 — 把 capacity 不足 / 溫層不符的扔到最後
  evals.sort((a, b) => {
    if (a.details.remaining_capacity < u.demand_boxes && b.details.remaining_capacity >= u.demand_boxes) return 1;
    if (a.details.remaining_capacity >= u.demand_boxes && b.details.remaining_capacity < u.demand_boxes) return -1;
    if (!a.details.temperature_match && b.details.temperature_match) return 1;
    if (a.details.temperature_match && !b.details.temperature_match) return -1;
    return b.score - a.score;
  });
  for (let i = 0; i < evals.length; i++) evals[i].rank = i + 1;

  return {
    urgent: u,
    candidates: evals,
    context: { drivers_evaluated: drivers.length, date: today }
  };
}

// ─────────────────────────────────────────────────────────────
// 3. Apply — 真實寫進 delivery_task_stops
// ─────────────────────────────────────────────────────────────
export async function applyUrgentDispatch(
  urgentId: string,
  driverId: string
): Promise<{ urgent: UrgentShipment; inserted_task_stop_id: string; insertion_position: number }> {
  const u = getUrgent(urgentId);
  if (!u) throw new Error(`Urgent ${urgentId} not found`);
  if (u.status !== "pending") throw new Error(`Urgent ${urgentId} 已派 — 狀態 ${u.status}`);

  const admin = createSupabaseAdminClient();
  const today = todayInTaipei();

  // 找該 driver 今天的 task；找不到就找最近一天當 dev fallback
  let { data: task } = await admin
    .from("delivery_tasks")
    .select("id, driver_id, delivery_date, status, driver_route_assignment_id")
    .eq("driver_id", driverId)
    .eq("delivery_date", today)
    .maybeSingle<{ id: string; driver_id: string; delivery_date: string; status: string; driver_route_assignment_id: string | null }>();
  if (!task) {
    const { data: latest } = await admin
      .from("delivery_tasks")
      .select("id, driver_id, delivery_date, status, driver_route_assignment_id")
      .eq("driver_id", driverId)
      .order("delivery_date", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; driver_id: string; delivery_date: string; status: string; driver_route_assignment_id: string | null }>();
    task = latest;
  }
  if (!task) {
    throw new Error("該物流士今日（或任何一天）尚無 delivery_task，無法插入急件");
  }

  // 找 driver 名字
  const { data: driver } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", driverId)
    .single<{ full_name: string }>();

  // 找最大 stop_order
  const { data: maxRow } = await admin
    .from("delivery_task_stops")
    .select("stop_order")
    .eq("delivery_task_id", task.id)
    .order("stop_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ stop_order: number }>();
  const nextOrder = (maxRow?.stop_order ?? 0) + 1;

  // 插一筆 task_stop（直接附加到尾巴最簡單；UI 上會顯示為「急件 — 第 N 站」）
  // 真正最佳位置 UI 已經算給主管看；如果未來要把它變成 cheapest-insertion 的位置，
  // 需要 reorder 整個 task 的 stop_order，那是 phase 2
  const plannedAt = new Date();
  // delivery_task_stops 只有基本欄位（schema 不存 estimated_*）；
  // 預估服務時間 / 貨量這些屬於 stops 主檔 + urgent_shipments，需要時 join 取得。
  const { data: inserted, error: insErr } = await admin
    .from("delivery_task_stops")
    .insert({
      delivery_task_id: task.id,
      stop_id: u.stop_id,
      stop_order: nextOrder,
      status: "pending",
      planned_arrival_at: plannedAt.toISOString(),
      trip_index: 1 // 急件不分趟，直接放第 1 趟尾
    })
    .select("id")
    .single<{ id: string }>();
  if (insErr) {
    throw new Error(`插入急件 task_stop 失敗: ${insErr.message}`);
  }

  u.status = "assigned";
  u.assigned_driver_id = driverId;
  u.assigned_driver_name = driver?.full_name ?? null;
  u.assigned_at = new Date().toISOString();
  upsertUrgent(u);

  return {
    urgent: u,
    inserted_task_stop_id: inserted!.id,
    insertion_position: nextOrder
  };
}

// ─────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────
function stableHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function hourFromNow(addH: number): string {
  const d = new Date();
  d.setHours(d.getHours() + addH);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// re-export for routes
export { listUrgent, getUrgent };

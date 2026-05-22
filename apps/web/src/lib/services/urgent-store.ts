import "server-only";

/**
 * 急件 (Urgent Shipment) 服務 — 暫時用 process-scoped in-memory store。
 *
 * 為什麼不直接接 Supabase?
 *   - DEMO seed 沒建 urgent_shipments 表，部署門檻越低越好
 *   - 急件本來就是「短時間 ephemeral」資料，一天清一次 reasonable
 *
 * 切真實 DB 的時候：
 *   - 把 `_STORE` 換成 supabase.from("urgent_shipments")
 *   - 介面（list / create / dispatch / clear）一字不改
 */

export type UrgentStatus = "pending" | "assigned" | "completed" | "cancelled";
export type UrgentPriority = "p0_critical" | "p1_high" | "p2_normal";

export interface UrgentShipment {
  id: string;
  /** 配送目標 stop_id（真實 stops 表） */
  stop_id: string;
  stop_name: string;
  stop_address: string;
  lat: number;
  lng: number;
  /** 需求箱數 */
  demand_boxes: number;
  /** 必要溫層: frozen / chilled / ambient / mixed */
  temperature: string;
  /** 偏好班別: day / night / any */
  preferred_shift: "day" | "night" | "any";
  priority: UrgentPriority;
  /** 客戶 deadline (HH:MM, 24h)；null = 無 */
  deadline_hm: string | null;
  /** 來源：customer_call / api / vip 客戶手動 */
  source: string;
  /** 客戶備註 */
  notes: string;
  status: UrgentStatus;
  /** 分派給哪位 driver（assigned 後才有） */
  assigned_driver_id: string | null;
  assigned_driver_name: string | null;
  /** AI 派遣分數明細 */
  dispatch_meta?: {
    rank: number;
    score: number;
    candidates: Array<{ driver_id: string; driver_name: string; score: number; reason: string }>;
  } | null;
  created_at: string;
  assigned_at: string | null;
}

// process-scoped (resets on server restart — perfect for demo)
const _STORE: Map<string, UrgentShipment> = (globalThis as any).__sigmile_urgent_store__
  ?? ((globalThis as any).__sigmile_urgent_store__ = new Map<string, UrgentShipment>());

export function listUrgent(filter?: { status?: UrgentStatus }): UrgentShipment[] {
  const all = Array.from(_STORE.values());
  if (filter?.status) return all.filter((u) => u.status === filter.status);
  return all.sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  );
}

export function getUrgent(id: string): UrgentShipment | null {
  return _STORE.get(id) ?? null;
}

export function upsertUrgent(s: UrgentShipment): UrgentShipment {
  _STORE.set(s.id, s);
  return s;
}

export function clearAllUrgent(): number {
  const n = _STORE.size;
  _STORE.clear();
  return n;
}

export function generateUrgentId(): string {
  return `URG-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

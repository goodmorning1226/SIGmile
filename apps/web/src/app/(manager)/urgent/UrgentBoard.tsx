"use client";

import { useEffect, useState, useTransition, useMemo } from "react";
import {
  Sparkles, Zap, Clock, Phone, CheckCircle2, Truck,
  RefreshCw, X, Users
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface UrgentShipment {
  id: string;
  stop_id: string;
  stop_name: string;
  stop_address: string;
  lat: number; lng: number;
  demand_boxes: number;
  temperature: string;
  preferred_shift: "day" | "night" | "any";
  priority: "p0_critical" | "p1_high" | "p2_normal";
  deadline_hm: string | null;
  source: string;
  notes: string;
  status: "pending" | "assigned" | "completed" | "cancelled";
  assigned_driver_id: string | null;
  assigned_driver_name: string | null;
  created_at: string;
  assigned_at: string | null;
}

export interface DriverCandidate {
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

interface DispatchResult {
  urgent: UrgentShipment;
  candidates: DriverCandidate[];
  context: { drivers_evaluated: number; date: string };
}

const PRIORITY_LABEL: Record<UrgentShipment["priority"], { tone: "danger" | "warning" | "info"; label: string }> = {
  p0_critical: { tone: "danger", label: "P0 緊急" },
  p1_high:     { tone: "warning", label: "P1 高優先" },
  p2_normal:   { tone: "info",    label: "P2 一般" }
};

const TEMP_ICON: Record<string, string> = {
  frozen:  "❄️",
  chilled: "🧊",
  ambient: "📦",
  mixed:   "🎁"
};

/** 派遣對話框的呈現模式：AI 排名 vs. 物流士清單（依姓名） */
type DispatchMode = "ai" | "list";

export function UrgentBoard() {
  const [items, setItems] = useState<UrgentShipment[]>([]);
  const [pendingFetch, startFetch] = useTransition();
  const [pendingDispatch, setPendingDispatch] = useState<string | null>(null);
  const [pendingApply, setPendingApply] = useState<string | null>(null);
  const [dispatchResult, setDispatchResult] = useState<DispatchResult | null>(null);
  const [dispatchMode, setDispatchMode] = useState<DispatchMode>("ai");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    startFetch(async () => {
      try {
        const res = await fetch("/api/manager/urgent");
        const j = await res.json();
        if (j.ok) setItems(j.data.items);
        else setError(j.error?.message ?? "讀取失敗");
      } catch (e) {
        setError(e instanceof Error ? e.message : "讀取失敗");
      }
    });
  };

  const dispatch = async (id: string, mode: DispatchMode) => {
    setError(null);
    setPendingDispatch(id);
    setDispatchMode(mode);
    try {
      const res = await fetch(`/api/manager/urgent/${id}/dispatch`, { method: "POST" });
      const j = await res.json();
      if (!j.ok) {
        setError(j.error?.message ?? "派遣失敗");
        return;
      }
      setDispatchResult(j.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知錯誤");
    } finally {
      setPendingDispatch(null);
    }
  };

  const apply = async (urgentId: string, driverId: string) => {
    setError(null);
    setPendingApply(driverId);
    try {
      const res = await fetch(`/api/manager/urgent/${urgentId}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ driver_id: driverId })
      });
      const j = await res.json();
      if (!j.ok) {
        setError(j.error?.message ?? "派遣寫入失敗");
        return;
      }
      setDispatchResult(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知錯誤");
    } finally {
      setPendingApply(null);
    }
  };

  useEffect(refresh, []);

  // 待派的放前面、已派遣 / 完成 / 取消 推到後面，內部依 priority + created_at 排
  const sortedItems = useMemo(() => {
    const rank = (s: UrgentShipment["status"]) =>
      s === "pending" ? 0 : s === "assigned" ? 1 : s === "completed" ? 2 : 3;
    const prio = (p: UrgentShipment["priority"]) =>
      p === "p0_critical" ? 0 : p === "p1_high" ? 1 : 2;
    return [...items].sort((a, b) => {
      if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
      if (prio(a.priority) !== prio(b.priority)) return prio(a.priority) - prio(b.priority);
      return a.created_at.localeCompare(b.created_at);
    });
  }, [items]);

  const pendingCount = items.filter((x) => x.status === "pending").length;
  const assignedCount = items.filter((x) => x.status === "assigned").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={refresh} loading={pendingFetch}>
          <RefreshCw className="size-4" /> 重新整理
        </Button>
        <span className="ml-auto text-xs text-slate-500">
          共 {items.length} 筆 · 待派 {pendingCount} · 已派 {assignedCount}
        </span>
      </div>

      {error && (
        <Card>
          <CardContent className="p-3 text-sm text-red-700">{error}</CardContent>
        </Card>
      )}

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">
            <Zap className="mx-auto mb-2 size-8 text-amber-300" />
            目前沒有任何急件。
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {sortedItems.map((u) => {
            const prio = PRIORITY_LABEL[u.priority];
            const isAssigned = u.status === "assigned";
            return (
              <Card
                key={u.id}
                className={isAssigned ? "opacity-70 bg-slate-50/40" : undefined}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge tone={prio.tone}>{prio.label}</Badge>
                        <span className="text-lg leading-none">
                          {TEMP_ICON[u.temperature] ?? "📦"}
                        </span>
                        <span className="text-xs text-slate-400">{u.id}</span>
                      </div>
                      <div className="mt-2 font-semibold text-slate-900">
                        {u.stop_name}
                      </div>
                      <div className="text-xs text-slate-500">{u.stop_address}</div>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      {u.deadline_hm && (
                        <div className="flex items-center gap-1">
                          <Clock className="size-3" />
                          {u.deadline_hm} deadline
                        </div>
                      )}
                      <div className="mt-1">{u.demand_boxes} 箱</div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                    <span><Phone className="mr-1 inline size-3" />{u.source}</span>
                    <span>溫層 {u.temperature}</span>
                    <span>偏好班別 {u.preferred_shift}</span>
                  </div>

                  {u.notes && (
                    <div className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                      💬 {u.notes}
                    </div>
                  )}

                  <div className="mt-3 border-t border-slate-100 pt-3">
                    {isAssigned ? (
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle2 className="size-4 text-accent-600" />
                        <span className="text-slate-700">
                          已派遣給 <strong>{u.assigned_driver_name}</strong>
                        </span>
                      </div>
                    ) : u.status === "pending" ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => dispatch(u.id, "list")}
                          loading={pendingDispatch === u.id && dispatchMode === "list"}
                        >
                          <Users className="size-4" /> 選擇物流士
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => dispatch(u.id, "ai")}
                          loading={pendingDispatch === u.id && dispatchMode === "ai"}
                        >
                          <Sparkles className="size-4" /> AI 派遣建議
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">狀態：{u.status}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {dispatchResult && (
        <DispatchDialog
          result={dispatchResult}
          mode={dispatchMode}
          onClose={() => setDispatchResult(null)}
          onApply={(driverId) => apply(dispatchResult.urgent.id, driverId)}
          pendingApply={pendingApply}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
 * 派遣對話框 — 共用「AI 排名」與「物流士清單」兩種模式
 *   - mode="ai"   → 依分數排序（已是 server 給的順序）
 *   - mode="list" → 依姓名 / employee_code 排序，每位皆可選
 *   兩種模式都顯示相同的物流士詳情（距離、容量、班別、溫層、繞路 Δ…）
 * ──────────────────────────────────────────────────────────── */
export function DispatchDialog({
  result, mode, onClose, onApply, pendingApply
}: {
  result: DispatchResult;
  mode: DispatchMode;
  onClose: () => void;
  onApply: (driverId: string) => void;
  pendingApply: string | null;
}) {
  const items = useMemo(() => {
    if (mode === "ai") return result.candidates;
    // list 模式：依姓名排序，並重新標 rank
    return [...result.candidates]
      .sort((a, b) =>
        (a.employee_code ?? a.driver_name).localeCompare(b.employee_code ?? b.driver_name)
      )
      .map((c, i) => ({ ...c, rank: i + 1 }));
  }, [result.candidates, mode]);

  const title = mode === "ai" ? "AI 派遣建議" : "選擇物流士";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6 backdrop-blur-sm">
      <Card className="my-8 w-full max-w-3xl">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle>{title}</CardTitle>
              <div className="mt-1 text-xs text-slate-500">
                急件 {result.urgent.stop_name} · {result.urgent.demand_boxes} 箱 ·
                {" "}{mode === "ai" ? `評估了 ${result.context.drivers_evaluated} 位物流士` : `共 ${result.context.drivers_evaluated} 位物流士可選`}
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
              <X className="size-5" />
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {items.map((c) => {
              const blocked = !c.details.temperature_match
                || c.details.remaining_capacity < result.urgent.demand_boxes;
              const recommended = mode === "ai" && c.rank === 1 && !blocked;
              return (
                <li
                  key={c.driver_id}
                  className={
                    "rounded-md border p-3 " +
                    (recommended
                      ? "border-accent-300 bg-accent-50/50"
                      : "border-slate-200 bg-slate-50/30")
                  }
                >
                  <div className="flex items-start gap-3">
                    <div className={
                      "grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold " +
                      (recommended ? "bg-accent-500 text-white" : "bg-slate-200 text-slate-600")
                    }>
                      {mode === "ai" ? `#${c.rank}` : <Truck className="size-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Truck className="size-3.5 text-slate-500" />
                        <span className="font-semibold">{c.driver_name}</span>
                        {c.employee_code && (
                          <span className="text-xs text-slate-400">{c.employee_code}</span>
                        )}
                        {mode === "ai" && (
                          <span className="ml-auto font-mono text-sm tabular-nums text-slate-700">
                            {(c.score * 100).toFixed(1)} 分
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-slate-600">{c.reason}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                        <Chip>{c.details.distance_km.toFixed(1)} km</Chip>
                        <Chip>剩 {c.details.remaining_capacity} 箱</Chip>
                        <Chip>pending {c.details.pending_stops}</Chip>
                        <Chip>插入 Δ {c.insertion_delta_km.toFixed(1)} km</Chip>
                        {!c.details.shift_match && <Chip tone="danger">班別不符</Chip>}
                        {!c.details.temperature_match && <Chip tone="danger">溫層不符</Chip>}
                        {c.details.remaining_capacity < result.urgent.demand_boxes && (
                          <Chip tone="danger">容量不足</Chip>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={blocked ? "outline" : "primary"}
                      disabled={blocked}
                      onClick={() => onApply(c.driver_id)}
                      loading={pendingApply === c.driver_id}
                    >
                      確認派遣
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "danger" }) {
  const cls = tone === "danger"
    ? "bg-red-50 text-red-700 border-red-200"
    : "bg-slate-100 text-slate-700 border-slate-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 ${cls}`}>
      {children}
    </span>
  );
}

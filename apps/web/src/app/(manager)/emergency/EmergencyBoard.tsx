"use client";

import { useEffect, useState, useTransition, useMemo } from "react";
import {
  AlertTriangle, RefreshCw, LifeBuoy, Loader2,
  X, MapPin, Sparkles, Users, Wand2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DispatchDialog, type DriverCandidate } from "../urgent/UrgentBoard";

interface DriverSnapshot {
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

interface PendingStop {
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

interface StopCandidatesResp {
  stop: PendingStop & { from_driver_id: string };
  candidates: DriverCandidate[];
  context: { drivers_evaluated: number; date: string };
}

type DispatchMode = "ai" | "list";

export function EmergencyBoard() {
  const [drivers, setDrivers] = useState<DriverSnapshot[]>([]);
  const [date, setDate] = useState<string>("");
  const [pendingLoad, startLoad] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 翹班物流士的 pending stops dialog
  const [activeDriver, setActiveDriver] = useState<DriverSnapshot | null>(null);
  const [pendingStops, setPendingStops] = useState<PendingStop[] | null>(null);
  const [loadingStops, setLoadingStops] = useState(false);

  // per-stop dispatch dialog（重用 urgent 的 DispatchDialog）
  const [candidateResp, setCandidateResp] = useState<StopCandidatesResp | null>(null);
  const [dispatchMode, setDispatchMode] = useState<DispatchMode>("ai");
  const [pendingCandidates, setPendingCandidates] = useState<string | null>(null);
  const [pendingApply, setPendingApply] = useState<string | null>(null);

  // AI 一鍵派遣（呼叫 /api/manager/emergency/plan + /apply）
  const [aiBatchPending, setAiBatchPending] = useState(false);

  const load = () => {
    setError(null);
    startLoad(async () => {
      try {
        const res = await fetch("/api/manager/emergency/today");
        const j = await res.json();
        if (!j.ok) {
          setError(j.error?.message ?? "讀取失敗");
          return;
        }
        setDrivers(j.data.drivers);
        setDate(j.data.date);
      } catch (e) {
        setError(e instanceof Error ? e.message : "讀取失敗");
      }
    });
  };

  const openReassign = async (d: DriverSnapshot) => {
    setError(null);
    setActiveDriver(d);
    setPendingStops(null);
    setLoadingStops(true);
    try {
      const res = await fetch(
        `/api/manager/emergency/driver-stops?driver_id=${encodeURIComponent(d.driver_id)}&date=${encodeURIComponent(date)}`
      );
      const j = await res.json();
      if (!j.ok) {
        setError(j.error?.message ?? "讀取失敗");
        return;
      }
      setPendingStops(j.data.stops);
    } catch (e) {
      setError(e instanceof Error ? e.message : "讀取失敗");
    } finally {
      setLoadingStops(false);
    }
  };

  const closeReassign = () => {
    setActiveDriver(null);
    setPendingStops(null);
  };

  /**
   * AI 一鍵派遣 — 把該 driver 全部 pending stops 直接套用 AI 排程方案：
   *  1. POST /api/manager/emergency/plan → 得到全 stops 的最佳目標 driver
   *  2. POST /api/manager/emergency/apply → 一次寫回 delivery_task_stops
   *  3. 重抓 pending stops + driver snapshot
   * 套用後使用者仍可繼續用 「選擇物流士 / AI 派遣建議」對個別站做調整（移到下一個 driver 的 dialog）。
   */
  const aiBatchDispatch = async () => {
    if (!activeDriver) return;
    if (!confirm(
      `用 AI 一鍵派遣這 ${activeDriver.pending_stops} 個 pending stops 嗎？\n` +
      `AI 會幫每個 stop 挑最佳的接手 driver；套用後你仍可逐站手動調整。`
    )) return;

    setError(null);
    setAiBatchPending(true);
    try {
      // 1) 拿到 AI 規劃方案
      const planRes = await fetch("/api/manager/emergency/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ down_driver_id: activeDriver.driver_id, date })
      });
      const planJ = await planRes.json();
      if (!planJ.ok) {
        setError(planJ.error?.message ?? "AI 規劃失敗");
        return;
      }
      // 2) 直接套用
      const applyRes = await fetch("/api/manager/emergency/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: planJ.data })
      });
      const applyJ = await applyRes.json();
      if (!applyJ.ok) {
        setError(applyJ.error?.message ?? "套用失敗");
        return;
      }
      // 3) 重抓資料
      openReassign(activeDriver);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知錯誤");
    } finally {
      setAiBatchPending(false);
    }
  };

  const fetchCandidates = async (taskStopId: string, mode: DispatchMode) => {
    if (!activeDriver) return;
    setError(null);
    setPendingCandidates(taskStopId);
    setDispatchMode(mode);
    try {
      const res = await fetch("/api/manager/emergency/stop-candidates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task_stop_id: taskStopId,
          exclude_driver_id: activeDriver.driver_id,
          date
        })
      });
      const j = await res.json();
      if (!j.ok) {
        setError(j.error?.message ?? "讀取候選失敗");
        return;
      }
      setCandidateResp(j.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知錯誤");
    } finally {
      setPendingCandidates(null);
    }
  };

  const apply = async (driverId: string) => {
    if (!candidateResp || !activeDriver) return;
    setError(null);
    setPendingApply(driverId);
    try {
      const res = await fetch("/api/manager/emergency/move-stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task_stop_id: candidateResp.stop.task_stop_id,
          target_driver_id: driverId,
          date
        })
      });
      const j = await res.json();
      if (!j.ok) {
        setError(j.error?.message ?? "搬遷失敗");
        return;
      }
      setCandidateResp(null);
      // 重抓 pending stops 與整體 snapshot
      openReassign(activeDriver);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知錯誤");
    } finally {
      setPendingApply(null);
    }
  };

  useEffect(load, []);

  // 把急件 DispatchDialog 需要的 urgent 物件 shape 拼出來（共用元件）
  const dispatchPayload = useMemo(() => {
    if (!candidateResp) return null;
    return {
      urgent: {
        id: candidateResp.stop.task_stop_id,
        stop_id: candidateResp.stop.stop_id,
        stop_name: candidateResp.stop.stop_name,
        stop_address: candidateResp.stop.stop_address ?? "",
        lat: candidateResp.stop.lat ?? 0,
        lng: candidateResp.stop.lng ?? 0,
        demand_boxes: candidateResp.stop.demand_boxes,
        temperature: candidateResp.stop.temperature ?? "chilled",
        preferred_shift: (candidateResp.stop.preferred_shift ?? "any") as "day" | "night" | "any",
        priority: "p1_high" as const,
        deadline_hm: null,
        source: "緊急應變",
        notes: "",
        status: "pending" as const,
        assigned_driver_id: null,
        assigned_driver_name: null,
        created_at: new Date().toISOString(),
        assigned_at: null
      },
      candidates: candidateResp.candidates,
      context: candidateResp.context
    };
  }, [candidateResp]);

  if (pendingLoad && drivers.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-slate-500">
          <Loader2 className="mx-auto mb-2 size-6 animate-spin" />
          載入今日進度…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500">資料日期：{date || "(無)"}</span>
        <Button variant="outline" size="sm" onClick={load} loading={pendingLoad} className="ml-auto">
          <RefreshCw className="size-3.5" />
          重新整理
        </Button>
      </div>

      {error && (
        <Card>
          <CardContent className="p-3 text-sm text-red-700">{error}</CardContent>
        </Card>
      )}

      {drivers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">
            <LifeBuoy className="mx-auto mb-2 size-8 text-slate-300" />
            今日沒有任何 delivery_task。請先到「發布新路線」採用一份路線。
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {drivers.map((d) => {
            const completionRate = d.total_stops === 0 ? 0 : d.completed_stops / d.total_stops;
            const isCancelled = d.task_status === "cancelled";
            return (
              <Card key={d.driver_id}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{d.driver_name}</span>
                        {d.employee_code && (
                          <span className="text-xs text-slate-400">{d.employee_code}</span>
                        )}
                        {isCancelled && <Badge tone="danger">已取消</Badge>}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        班 {d.shift ?? "-"} · 車容 {d.vehicle_capacity}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-semibold tabular-nums">
                        {d.completed_stops}/{d.total_stops}
                      </div>
                      <div className="text-xs text-slate-400">完成</div>
                    </div>
                  </div>

                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full bg-brand-500 transition-all"
                      style={{ width: `${(completionRate * 100).toFixed(0)}%` }}
                    />
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-slate-500">
                      pending {d.pending_stops} · 完成率 {(completionRate * 100).toFixed(0)}%
                    </span>
                  </div>

                  {!isCancelled && (
                    <Button
                      variant={d.pending_stops > 0 ? "danger" : "outline"}
                      size="sm"
                      className="mt-3 w-full"
                      disabled={d.pending_stops === 0}
                      onClick={() => openReassign(d)}
                    >
                      <AlertTriangle className="size-4" />
                      重新派遣方案
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* 翹班 driver 的 pending stops 列表 */}
      {activeDriver && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6 backdrop-blur-sm">
          <Card className="my-8 w-full max-w-3xl">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle>重新派遣方案 — {activeDriver.driver_name}</CardTitle>
                  <div className="mt-1 text-xs text-slate-500">
                    {activeDriver.employee_code ?? "—"} · 剩 pending {activeDriver.pending_stops} 站；逐一挑選誰要接
                  </div>
                </div>
                <button onClick={closeReassign} className="text-slate-400 hover:text-slate-700">
                  <X className="size-5" />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingStops ? (
                <div className="py-8 text-center text-sm text-slate-500">
                  <Loader2 className="mx-auto mb-2 size-5 animate-spin" />
                  載入中…
                </div>
              ) : !pendingStops || pendingStops.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-500">
                  此物流士目前已無 pending stops。
                </div>
              ) : (
                <>
                  {/* AI 一鍵派遣 — 套用後仍可對每個站手動調整 */}
                  <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <Wand2 className="size-4 shrink-0 text-brand-500" />
                      <span className="text-slate-700">
                        AI 會用 cheapest-insertion 把 {pendingStops.length} 個 stop 自動分到其他物流士；
                        套用後仍可逐站調整。
                      </span>
                    </div>
                    <Button
                      size="sm"
                      onClick={aiBatchDispatch}
                      loading={aiBatchPending}
                      className="shrink-0"
                    >
                      <Wand2 className="size-3.5" />
                      AI 一鍵派遣
                    </Button>
                  </div>
                  <ul className="space-y-2">
                  {pendingStops.map((s) => (
                    <li
                      key={s.task_stop_id}
                      className="rounded-md border border-slate-200 bg-slate-50/40 p-3"
                    >
                      <div className="flex items-start gap-3">
                        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-500 text-white text-xs font-bold">
                          {s.stop_order}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900">{s.stop_name}</span>
                            {s.stop_external_code && (
                              <span className="text-xs text-slate-400">{s.stop_external_code}</span>
                            )}
                          </div>
                          {s.stop_address && (
                            <div className="mt-0.5 text-xs text-slate-500">
                              <MapPin className="mr-1 inline size-3" />
                              {s.stop_address}
                            </div>
                          )}
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                            <span>📦 {s.demand_boxes} 箱</span>
                            {s.temperature && <span>溫層 {s.temperature}</span>}
                            {s.service_minutes != null && <span>服務 {s.service_minutes} 分</span>}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => fetchCandidates(s.task_stop_id, "list")}
                            loading={pendingCandidates === s.task_stop_id && dispatchMode === "list"}
                          >
                            <Users className="size-3.5" />
                            選擇物流士
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => fetchCandidates(s.task_stop_id, "ai")}
                            loading={pendingCandidates === s.task_stop_id && dispatchMode === "ai"}
                          >
                            <Sparkles className="size-3.5" />
                            AI 派遣建議
                          </Button>
                        </div>
                      </div>
                    </li>
                  ))}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* 共用 DispatchDialog（與 UrgentBoard 完全一樣） */}
      {dispatchPayload && (
        <DispatchDialog
          result={dispatchPayload}
          mode={dispatchMode}
          onClose={() => setCandidateResp(null)}
          onApply={(driverId) => apply(driverId)}
          pendingApply={pendingApply}
        />
      )}
    </div>
  );
}


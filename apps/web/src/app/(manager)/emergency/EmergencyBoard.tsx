"use client";

import { useEffect, useState, useTransition } from "react";
import {
  AlertTriangle, RefreshCw, ArrowRight, LifeBuoy,
  CheckCircle2, X, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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

interface ReassignedStop {
  task_stop_id: string;
  stop_id: string;
  stop_name: string;
  from_driver_id: string;
  from_driver_name: string;
  to_driver_id: string | null;
  to_driver_name: string | null;
  insertion_after_index: number | null;
  delta_km: number;
  reason: string;
  unassign_reason: string | null;
}

interface ReroutePlan {
  date: string;
  down_driver: DriverSnapshot;
  reassigned: ReassignedStop[];
  unassignable: ReassignedStop[];
  summary: {
    pending_taken: number;
    distributed_to_drivers: number;
    total_delta_km: number;
    confidence: number;
  };
}

export function EmergencyBoard() {
  const [drivers, setDrivers] = useState<DriverSnapshot[]>([]);
  const [date, setDate] = useState<string>("");
  const [pendingLoad, startLoad] = useTransition();
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const [pendingApply, startApply] = useTransition();
  const [plan, setPlan] = useState<ReroutePlan | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const planFor = async (driverId: string) => {
    setError(null);
    setPendingPlan(driverId);
    try {
      const res = await fetch("/api/manager/emergency/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ down_driver_id: driverId, date })
      });
      const j = await res.json();
      if (!j.ok) {
        setError(j.error?.message ?? "計畫失敗");
        return;
      }
      setPlan(j.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知錯誤");
    } finally {
      setPendingPlan(null);
    }
  };

  const apply = () => {
    if (!plan) return;
    if (!confirm(`確認重派 ${plan.reassigned.length} 個 stops？(${plan.summary.distributed_to_drivers} 位 driver, +${plan.summary.total_delta_km} km 總繞路)`)) return;
    setError(null);
    startApply(async () => {
      try {
        const res = await fetch("/api/manager/emergency/apply", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ plan })
        });
        const j = await res.json();
        if (!j.ok) {
          setError(j.error?.message ?? "套用失敗");
          return;
        }
        setPlan(null);
        load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "未知錯誤");
      }
    });
  };

  useEffect(load, []);

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

                  {/* Progress bar */}
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
                      loading={pendingPlan === d.driver_id}
                      onClick={() => planFor(d.driver_id)}
                    >
                      <AlertTriangle className="size-4" />
                      標記翹班 → AI 重派
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {plan && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6 backdrop-blur-sm">
          <Card className="my-8 w-full max-w-4xl">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle>緊急重派方案</CardTitle>
                  <div className="mt-1 text-xs text-slate-500">
                    {plan.down_driver.driver_name} 翹班 → 重派 {plan.reassigned.length} 個 stop
                    {plan.unassignable.length > 0 && ` · ⚠️ ${plan.unassignable.length} 個無人可接`}
                  </div>
                </div>
                <button onClick={() => setPlan(null)} className="text-slate-400 hover:text-slate-700">
                  <X className="size-5" />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="搬遷站數" value={String(plan.summary.pending_taken)} />
                <Stat label="分散給" value={`${plan.summary.distributed_to_drivers} 位 driver`} />
                <Stat label="總繞路" value={`+${plan.summary.total_delta_km} km`} />
                <Stat
                  label="信心分數"
                  value={`${(plan.summary.confidence * 100).toFixed(0)}%`}
                  tone={plan.summary.confidence < 0.6 ? "warn" : "good"}
                />
              </div>

              <div className="mt-5">
                <div className="mb-2 text-sm font-semibold">重派明細：</div>
                <div className="space-y-1">
                  {plan.reassigned.map((r) => (
                    <div
                      key={r.task_stop_id}
                      className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50/40 px-3 py-2 text-sm"
                    >
                      <span className="font-medium text-slate-900">{r.stop_name}</span>
                      <ArrowRight className="size-3.5 shrink-0 text-slate-400" />
                      <span className="text-accent-700">{r.to_driver_name}</span>
                      <span className="ml-auto text-xs text-slate-500">
                        +{r.delta_km.toFixed(1)} km · {r.reason}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {plan.unassignable.length > 0 && (
                <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
                  <div className="mb-1 flex items-center gap-1 text-sm font-semibold text-amber-900">
                    <AlertTriangle className="size-4" />
                    無人可接 ({plan.unassignable.length})
                  </div>
                  <ul className="space-y-0.5 text-xs text-amber-900">
                    {plan.unassignable.map((r) => (
                      <li key={r.task_stop_id}>
                        {r.stop_name} — {r.unassign_reason}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-1.5 text-xs text-amber-700">
                    這些 stop 仍掛在原 driver；建議主管手動聯繫客戶延後或調度後備車輛。
                  </div>
                </div>
              )}

              <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
                <Button variant="outline" onClick={() => setPlan(null)}>取消</Button>
                <Button
                  variant="primary"
                  onClick={apply}
                  loading={pendingApply}
                  disabled={plan.reassigned.length === 0}
                >
                  <CheckCircle2 className="size-4" />
                  確認重派 ({plan.reassigned.length})
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tone === "warn" ? "text-amber-600" : tone === "good" ? "text-accent-700" : "text-slate-900"}`}>
        {value}
      </div>
    </div>
  );
}

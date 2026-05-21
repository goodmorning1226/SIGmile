"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Truck, Save, RotateCcw, Check, AlertCircle, MapPin, Package
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import { SHIFT_LABEL, TEMP_LABEL, type ShiftType, type TemperatureType }
  from "@/types/domain";
import type { PlanForEdit } from "@/lib/services/cluster-service";

export interface DriverOption {
  id: string;
  full_name: string;
  employee_code: string | null;
  shift: string | null;
  vehicle_capacity: number | null;
  temperature_capability: string | null;
}

/**
 * 一個橫向的「卡片牆」：左邊一張一張的 cluster 卡，右邊是 driver dropdown。
 * 主管在 dropdown 選 driver，就算指派。儲存後同步寫回 driver_clusters + driver_route_assignments。
 */
export function AssignmentBoard({
  plan, drivers, readOnly = false
}: {
  plan: PlanForEdit;
  drivers: DriverOption[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const initialMap = useMemo(() => {
    const m: Record<string, string | null> = {};
    for (const c of plan.clusters) m[c.id] = c.assigned_driver_id;
    return m;
  }, [plan.clusters]);

  const [assigned, setAssigned] = useState<Record<string, string | null>>(initialMap);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = useMemo(() => {
    return JSON.stringify(assigned) !== JSON.stringify(initialMap);
  }, [assigned, initialMap]);

  // 每位 driver 目前被分到幾個 cluster？（用來標「已分配」）
  const driverLoad = useMemo(() => {
    const load: Record<string, number> = {};
    for (const cid in assigned) {
      const did = assigned[cid];
      if (did) load[did] = (load[did] ?? 0) + 1;
    }
    return load;
  }, [assigned]);

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/manager/assignment/save", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            plan_id: plan.id,
            assignments: Object.entries(assigned).map(([cluster_id, driver_id]) => ({
              cluster_id, driver_id
            }))
          })
        });
        const j = await res.json();
        if (!j.ok) throw new Error(j.error?.message ?? "儲存失敗");
        setSavedAt(new Date().toLocaleTimeString("zh-TW"));
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "未知錯誤");
      }
    });
  };

  if (plan.clusters.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-slate-500">
          此版本沒有任何路線集。請先到「發布新路線」跑 OR 試算。
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 -mx-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/95 px-2 py-2 backdrop-blur ring-1 ring-slate-200">
        <div className="text-xs text-slate-500">
          共 {plan.clusters.length} 群、{drivers.length} 位物流士可選
          ·  已分配 {Object.values(assigned).filter(Boolean).length} / {plan.clusters.length} 群
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-red-600">{error}</span>}
            {savedAt && !dirty && (
              <span className="inline-flex items-center gap-1 text-xs text-accent-700">
                <Check className="size-3" /> 已儲存 {savedAt}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setAssigned(initialMap); setSavedAt(null); setError(null); }}
              disabled={!dirty || pending}
            >
              <RotateCcw className="size-3.5" /> 還原
            </Button>
            <Button size="sm" onClick={save} disabled={!dirty} loading={pending}>
              <Save className="size-3.5" /> 儲存指派
            </Button>
          </div>
        )}
      </div>

      {/* Cluster cards */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {plan.clusters.map((c, ci) => {
          const driverId = assigned[c.id] ?? null;
          const driver = drivers.find((d) => d.id === driverId) ?? null;
          const mismatch = driver ? checkMismatch(c, driver) : null;

          return (
            <Card
              key={c.id}
              className={cn(
                "transition",
                driverId ? "border-accent-200" : "border-slate-200"
              )}
            >
              <CardContent className="p-4">
                {/* 群組標題 */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                      {ci + 1}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-slate-900">
                        {c.cluster_name}
                      </div>
                      <div className="text-xs text-slate-500">
                        {c.stops.length} 站
                        {(c.estimated_total_volume ?? 0) > 0 && (
                          <> · 約 {c.estimated_total_volume} 箱</>
                        )}
                      </div>
                    </div>
                  </div>
                  {c.required_shift && (
                    <Badge tone="info">
                      {SHIFT_LABEL[c.required_shift as ShiftType] ?? c.required_shift}
                    </Badge>
                  )}
                </div>

                {/* 站點摘要（最多顯示 3 個） */}
                <div className="mt-3 space-y-1">
                  {c.stops.slice(0, 3).map((s) => (
                    <div
                      key={s.route_stop_id}
                      className="flex items-center gap-1.5 text-xs text-slate-600"
                    >
                      <MapPin className="size-3 shrink-0 text-slate-400" />
                      <span className="truncate">
                        {s.stop_name}
                      </span>
                    </div>
                  ))}
                  {c.stops.length > 3 && (
                    <div className="text-xs text-slate-400">
                      … 還有 {c.stops.length - 3} 站
                    </div>
                  )}
                </div>

                {/* 指派 dropdown */}
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">
                    指派給：
                  </label>
                  <select
                    value={driverId ?? ""}
                    disabled={readOnly}
                    onChange={(e) => {
                      setAssigned((a) => ({ ...a, [c.id]: e.target.value || null }));
                    }}
                    className={cn(
                      "h-10 w-full rounded-md border px-3 text-sm",
                      driverId
                        ? "border-accent-300 bg-accent-50"
                        : "border-slate-300 bg-white",
                      readOnly && "cursor-not-allowed opacity-90"
                    )}
                  >
                    <option value="">— 未指派 —</option>
                    {drivers.map((d) => {
                      const load = driverLoad[d.id] ?? 0;
                      // 排除自己也算
                      const otherLoad = driverId === d.id ? load - 1 : load;
                      const isThisOne = driverId === d.id;
                      return (
                        <option key={d.id} value={d.id}>
                          {d.full_name}
                          {d.employee_code ? ` (${d.employee_code})` : ""}
                          {d.shift ? ` · ${SHIFT_LABEL[d.shift as ShiftType] ?? d.shift}` : ""}
                          {otherLoad > 0 && !isThisOne ? ` · 已分 ${otherLoad} 群` : ""}
                        </option>
                      );
                    })}
                  </select>

                  {/* 警示：班別 / 容量 / 溫層不符 */}
                  {driver && mismatch && (
                    <div className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-2 py-1.5 text-xs text-amber-800">
                      <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
                      <span>{mismatch}</span>
                    </div>
                  )}
                  {driver && !mismatch && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-accent-700">
                      <Check className="size-3" /> 指派完成
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 物流士 overview（誰拿到哪些群、誰沒被分到） */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Truck className="size-4 text-brand-500" />
            <span className="text-sm font-semibold text-slate-900">物流士分配總覽</span>
          </div>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {drivers.map((d) => {
              const myGroups = plan.clusters.filter((c) => assigned[c.id] === d.id);
              return (
                <li
                  key={d.id}
                  className={cn(
                    "rounded-md border px-3 py-2 text-sm",
                    myGroups.length > 0
                      ? "border-accent-200 bg-accent-50/40"
                      : "border-slate-200 bg-slate-50"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900">
                      {d.full_name}
                      {d.employee_code && <span className="ml-1 text-xs text-slate-500">{d.employee_code}</span>}
                    </span>
                    <span className="text-xs text-slate-600 tabular-nums">
                      {myGroups.length} 群 ·
                      {" "}
                      {myGroups.reduce((s, c) => s + c.stops.length, 0)} 站
                    </span>
                  </div>
                  {myGroups.length > 0 && (
                    <div className="mt-1 text-xs text-slate-500 truncate">
                      {myGroups.map((c) => c.cluster_name).join("、")}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

/** 檢查 cluster 屬性 vs driver 屬性是否相容 */
function checkMismatch(
  cluster: { required_shift: string | null; required_temperature: string | null;
             estimated_total_volume: number | null; stops: { stop_volume: number | null }[] },
  driver: DriverOption
): string | null {
  // 班別
  if (cluster.required_shift && driver.shift && cluster.required_shift !== driver.shift) {
    return `班別不符（群組需 ${SHIFT_LABEL[cluster.required_shift as ShiftType]}、物流士 ${SHIFT_LABEL[driver.shift as ShiftType]}）`;
  }
  // 溫層
  if (cluster.required_temperature && driver.temperature_capability &&
      cluster.required_temperature !== driver.temperature_capability &&
      driver.temperature_capability !== "mixed") {
    return `溫層不符（群組需 ${TEMP_LABEL[cluster.required_temperature as TemperatureType]}、車輛 ${TEMP_LABEL[driver.temperature_capability as TemperatureType]}）`;
  }
  // 容量
  const totalVol = cluster.estimated_total_volume ??
                   cluster.stops.reduce((s, x) => s + (x.stop_volume ?? 0), 0);
  if (driver.vehicle_capacity && totalVol > driver.vehicle_capacity) {
    return `容量可能不夠（群組 ${totalVol} 箱、車輛 ${driver.vehicle_capacity} 箱）`;
  }
  return null;
}

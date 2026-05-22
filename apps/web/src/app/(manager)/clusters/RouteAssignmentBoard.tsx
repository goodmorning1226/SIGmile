"use client";

import { useMemo, useState, useTransition, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Save, RotateCcw, Check, AlertCircle, Truck, Warehouse,
  GripVertical, X, Move
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import {
  SHIFT_LABEL, TEMP_LABEL,
  type ShiftType, type TemperatureType
} from "@/types/domain";
import type {
  ClusterStop, PlanForEdit, DriverOption
} from "@/lib/services/cluster-service";

/* ============================================================
 * 拖曳資料型別
 * ========================================================== */
interface DragSlot {
  /** 插入位置：插入後該 stop 會在 stops 陣列的 index = insertAt（0..N） */
  insertAt: number;
  /** 該 slot 代表的 trip_index（分隔線左側為 1、右側為 2） */
  trip: 1 | 2;
}

/* ============================================================
 * 內部編輯狀態（按「儲存」才寫回 server）
 * ========================================================== */
interface EditCluster {
  id: string;             // server cluster id（不會在前端新增 cluster，沒有 'new-*'）
  cluster_name: string;
  assigned_driver_id: string | null;
  required_shift: string | null;
  required_temperature: string | null;
  stops: ClusterStop[];   // 順序 = stop_order
}

function fromServer(plan: PlanForEdit): EditCluster[] {
  return plan.clusters.map((c) => ({
    id: c.id,
    cluster_name: c.cluster_name,
    assigned_driver_id: c.assigned_driver_id,
    required_shift: c.required_shift,
    required_temperature: c.required_temperature,
    stops: [...c.stops].sort((a, b) => a.stop_order - b.stop_order)
  }));
}

/* ============================================================
 * 主元件 — 路線分配
 *  每個 cluster 一條橫向 strip：
 *    [driver dropdown] [Stop][→time→][Stop][→time→]...
 *  - hover stop → 顯示 address + box count
 *  - click stop → popover 選「移到其他路線」
 *  - drag stop within row → 重排順序
 *  - 上排顯示路線總工時 / 總箱數 / 班別徽章
 * ========================================================== */
export function RouteAssignmentBoard({
  plan, readOnly = false
}: {
  plan: PlanForEdit;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [clusters, setClusters] = useState<EditCluster[]>(() => fromServer(plan));
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = useMemo(() => {
    return JSON.stringify(clusters) !== JSON.stringify(fromServer(plan));
  }, [clusters, plan]);

  // 把 travel_times 變 Map<from>to, minutes>
  const ttMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of plan.travel_times) {
      m.set(`${t.from_id}>${t.to_id}`, Number(t.duration_minutes));
    }
    return m;
  }, [plan.travel_times]);

  /* ───── actions ───── */
  const setDriverFor = (cid: string, driverId: string | null) => {
    setClusters((cs) => cs.map((c) =>
      c.id === cid ? { ...c, assigned_driver_id: driverId } : c
    ));
  };

  /**
   * insert-only：把第 fromIdx 的 stop 移到 insertAt 位置（0..N），並指定 trip_index。
   * trip 由 RouteStrip 端依「該 slot 視覺上位於 trip 分隔線哪一側」決定。
   */
  const insertStopAtSlot = (
    cid: string,
    fromIdx: number,
    insertAt: number,
    newTrip: 1 | 2
  ) => {
    setClusters((cs) => cs.map((c) => {
      if (c.id !== cid) return c;
      const arr = [...c.stops];
      const [moved] = arr.splice(fromIdx, 1);
      // 移除後重算實際 insert index
      const adjusted = insertAt > fromIdx ? insertAt - 1 : insertAt;
      arr.splice(adjusted, 0, { ...moved, trip_index: newTrip });
      return { ...c, stops: arr };
    }));
  };

  const moveStopBetweenClusters = (
    fromCid: string, stopIdx: number, toCid: string
  ) => {
    setClusters((cs) => {
      const fromC = cs.find((c) => c.id === fromCid);
      if (!fromC) return cs;
      const stop = fromC.stops[stopIdx];
      if (!stop) return cs;
      return cs.map((c) => {
        if (c.id === fromCid) {
          return { ...c, stops: c.stops.filter((_, i) => i !== stopIdx) };
        }
        if (c.id === toCid) {
          return { ...c, stops: [...c.stops, stop] };
        }
        return c;
      });
    });
  };

  const reset = () => {
    setClusters(fromServer(plan));
    setSavedAt(null);
    setError(null);
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        // 1) 先存 cluster 結構（站順序 + cluster 名稱）
        const clusterPayload = {
          plan_id: plan.id,
          clusters: clusters.map((c, ci) => ({
            cluster_name: c.cluster_name,
            sequence: ci + 1,
            stops: c.stops.map((s, si) => ({
              route_stop_id: s.route_stop_id,
              stop_order: si + 1,
              trip_index: s.trip_index ?? 1
            }))
          }))
        };
        const res1 = await fetch("/api/manager/clusters/save", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(clusterPayload)
        });
        const j1 = await res1.json();
        if (!j1.ok) throw new Error(j1.error?.message ?? "儲存路線結構失敗");

        // 2) 再存 driver assignment
        //    （cluster id 在上一步可能被重建；先重新撈一次 cluster_id by sequence）
        const planAfter = await fetch(
          `/api/manager/clusters/by-plan?plan_id=${plan.id}`,
          { method: "GET" }
        );
        let newClusterIds: string[] = [];
        if (planAfter.ok) {
          const planJ = await planAfter.json();
          newClusterIds = (planJ?.data?.clusters ?? [])
            .sort((a: { sequence: number }, b: { sequence: number }) => a.sequence - b.sequence)
            .map((c: { id: string }) => c.id);
        }
        const assignPayload = {
          plan_id: plan.id,
          assignments: clusters.map((c, ci) => ({
            cluster_id: newClusterIds[ci] ?? c.id,
            driver_id: c.assigned_driver_id
          }))
        };
        const res2 = await fetch("/api/manager/assignment/save", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(assignPayload)
        });
        const j2 = await res2.json();
        if (!j2.ok) throw new Error(j2.error?.message ?? "儲存物流士分配失敗");

        setSavedAt(new Date().toLocaleTimeString("zh-TW"));
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "未知錯誤");
      }
    });
  };

  /* ───── render ───── */
  if (clusters.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-slate-500">
          此版本沒有任何路線。請至「發布新路線」跑 OR 試算。
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 -mx-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/95 px-2 py-2 backdrop-blur ring-1 ring-slate-200">
        <div className="text-xs text-slate-500">
          共 {clusters.length} 條路線、
          {clusters.reduce((s, c) => s + c.stops.length, 0)} 站、
          已分配 {clusters.filter((c) => c.assigned_driver_id).length} / {clusters.length} 位物流士
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
              onClick={reset}
              disabled={!dirty || pending}
            >
              <RotateCcw className="size-3.5" /> 還原
            </Button>
            <Button size="sm" onClick={save} disabled={!dirty} loading={pending}>
              <Save className="size-3.5" /> 儲存
            </Button>
          </div>
        )}
      </div>

      {/* 路線 strip 列表 */}
      <div className="space-y-3">
        {clusters.map((c, ci) => (
          <RouteStrip
            key={c.id}
            index={ci}
            cluster={c}
            allClusters={clusters}
            drivers={plan.drivers}
            depotId={plan.depot_id}
            ttMap={ttMap}
            readOnly={readOnly}
            onChangeDriver={(did) => setDriverFor(c.id, did)}
            onInsertStop={(from, insertAt, trip) =>
              insertStopAtSlot(c.id, from, insertAt, trip)
            }
            onMoveStopOut={(sIdx, toCid) => moveStopBetweenClusters(c.id, sIdx, toCid)}
          />
        ))}
      </div>
    </div>
  );
}

/* ============================================================
 * RouteStrip — 一條橫向路線
 * ========================================================== */
interface RouteStripProps {
  index: number;
  cluster: EditCluster;
  allClusters: EditCluster[];
  drivers: DriverOption[];
  depotId: string | null;
  ttMap: Map<string, number>;
  readOnly: boolean;
  onChangeDriver: (driverId: string | null) => void;
  /** insert-only：fromIdx 的 stop 移到 insertAt（0..N），新的 trip_index 由 caller 決定 */
  onInsertStop: (fromIdx: number, insertAt: number, trip: 1 | 2) => void;
  onMoveStopOut: (stopIdx: number, toClusterId: string) => void;
}

function RouteStrip({
  index, cluster, allClusters, drivers, depotId, ttMap, readOnly,
  onChangeDriver, onInsertStop, onMoveStopOut
}: RouteStripProps) {
  const driver = drivers.find((d) => d.id === cluster.assigned_driver_id) ?? null;
  const totalVolume = cluster.stops.reduce((s, x) => s + (x.stop_volume ?? 0), 0);
  const mismatch = driver ? checkMismatch(cluster, driver) : null;

  // 算這條路線的總工時：sum of travel + service
  const totalMinutes = useMemo(() => {
    let total = 0;
    const seq = depotId
      ? [depotId, ...cluster.stops.map((s) => s.stop_id), depotId]
      : cluster.stops.map((s) => s.stop_id);
    for (let i = 0; i < seq.length - 1; i++) {
      const t = ttMap.get(`${seq[i]}>${seq[i + 1]}`) ?? 0;
      total += t;
    }
    for (const s of cluster.stops) {
      total += s.estimated_service_minutes ?? 0;
    }
    return Math.round(total);
  }, [cluster.stops, depotId, ttMap]);

  // ───── 拖曳狀態：insert-only ─────
  //  - dragSrcIdx：被拖站的 index
  //  - dragOverSlot：滑鼠當下 hover 的「插入槽」(insertAt + trip 一起記)
  //    insertAt = 插入後的目標 index（0..N）；trip = 該位置代表的 trip_index
  //    分隔線兩側會各有一個 slot（insertAt 相同、trip 不同）讓使用者明確選擇
  const [dragSrcIdx, setDragSrcIdx] = useState<number | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<DragSlot | null>(null);

  // trip 分隔線位置 = 第一個 trip_index==2 的 index；都是 trip-1 則回 stops.length
  //  拖動期間 cluster.stops 不會被改寫（drop 才寫入），所以這個位置在拖動時自然鎖住，
  //  不需要額外 capture。
  const visualBoundary = useMemo(() => {
    const i = cluster.stops.findIndex((s) => s.trip_index === 2);
    return i === -1 ? cluster.stops.length : i;
  }, [cluster.stops]);

  const isDragging = dragSrcIdx != null;

  const onDragStart = (srcIdx: number) => {
    setDragSrcIdx(srcIdx);
  };
  const onDragEnd = () => {
    setDragSrcIdx(null);
    setDragOverSlot(null);
  };

  // ❗ 安全網：browser native dragend 應該在 source 上觸發，但某些情況（source
  // 被 unmount、drop 在 iframe、ESC 取消…）會錯過。
  // 在 window 層面再掛一次 dragend，確保 state 一定被清乾淨。
  useEffect(() => {
    if (!isDragging) return;
    const cleanup = () => {
      setDragSrcIdx(null);
      setDragOverSlot(null);
    };
    window.addEventListener("dragend", cleanup);
    return () => window.removeEventListener("dragend", cleanup);
  }, [isDragging]);
  const onDropAtSlot = (insertAt: number, trip: 1 | 2) => {
    if (dragSrcIdx == null) {
      onDragEnd();
      return;
    }
    onInsertStop(dragSrcIdx, insertAt, trip);
    onDragEnd();
  };
  const isSlotActive = (insertAt: number, trip: 1 | 2) =>
    dragOverSlot != null &&
    dragOverSlot.insertAt === insertAt &&
    dragOverSlot.trip === trip;

  // 點擊 stop 時 popover state
  const [popoverIdx, setPopoverIdx] = useState<number | null>(null);

  const otherClusters = allClusters.filter((c) => c.id !== cluster.id);

  return (
    <Card className={cn(
      "transition",
      driver ? "border-accent-200" : "border-slate-200"
    )}>
      <CardContent className="p-4">
        {/* 路線標頭 */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
              {index + 1}
            </div>
            <div className="min-w-0">
              <div className="truncate font-semibold text-slate-900">
                {cluster.cluster_name}
              </div>
              <div className="text-xs text-slate-500">
                {cluster.stops.length} 站
                {totalMinutes > 0 && <> · 約 {totalMinutes} 分鐘</>}
                {totalVolume > 0 && <> · {totalVolume} 箱</>}
              </div>
            </div>
            {cluster.required_shift && (
              <Badge tone="info">
                {SHIFT_LABEL[cluster.required_shift as ShiftType] ?? cluster.required_shift}
              </Badge>
            )}
          </div>

          {/* 物流士 dropdown */}
          <div className="flex items-center gap-2">
            <Truck className="size-3.5 text-slate-400" />
            <select
              value={cluster.assigned_driver_id ?? ""}
              disabled={readOnly}
              onChange={(e) => onChangeDriver(e.target.value || null)}
              className={cn(
                "h-9 rounded-md border px-3 text-sm min-w-[12rem]",
                cluster.assigned_driver_id
                  ? "border-accent-300 bg-accent-50"
                  : "border-slate-300 bg-white",
                readOnly && "cursor-not-allowed opacity-90"
              )}
            >
              <option value="">— 未指派 —</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name}
                  {d.employee_code ? ` (${d.employee_code})` : ""}
                  {d.shift ? ` · ${SHIFT_LABEL[d.shift as ShiftType] ?? d.shift}` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {mismatch && (
          <div className="mb-2 flex items-start gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-2 py-1.5 text-xs text-amber-800">
            <AlertCircle className="size-3.5 shrink-0 mt-0.5" /><span>{mismatch}</span>
          </div>
        )}

        {/* Stop 橫條 — 不允許 y 軸滑動，tooltip 走 portal 不會撐高 */}
        {cluster.stops.length === 0 ? (
          <div className="rounded border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-xs text-slate-400">
            此路線目前無停靠點
          </div>
        ) : (
          <div
            className="flex flex-nowrap items-center gap-0 overflow-x-auto"
            style={{ overflowY: "visible" }}
          >
            {/*
              ────────────────────────────────────────────────────
              關鍵：每個 StopBox 用 stop-${route_stop_id} 當 stable key，
              讓 React 在 cluster.stops 重排後仍視為「同一個 DOM 節點」，
              拖動中的 source 不會被卸載 → native dragend 才會正常觸發、
              dragSrcIdx 才會被清乾淨，後續才能繼續拖。
              ────────────────────────────────────────────────────
            */}
            {buildStripItems({
              stops: cluster.stops,
              depotId,
              visualBoundary,
              isDragging,
              ttMap
            }).map((it) => {
              switch (it.kind) {
                case "depot":
                  return <DepotNode key={it.key} label={it.label} dashed={it.dashed} />;
                case "arrow":
                  return <TravelArrow key={it.key} minutes={it.minutes} />;
                case "divider":
                  return <TripDivider key={it.key} />;
                case "slot":
                  return (
                    <DropSlot
                      key={it.key}
                      visible
                      active={isSlotActive(it.insertAt, it.trip)}
                      onDragOver={() => setDragOverSlot({ insertAt: it.insertAt, trip: it.trip })}
                      onDrop={() => onDropAtSlot(it.insertAt, it.trip)}
                    />
                  );
                case "stop":
                  return (
                    <StopBox
                      key={it.key}
                      stop={it.stop}
                      index={it.index}
                      readOnly={readOnly}
                      isDragSource={dragSrcIdx === it.index}
                      onDragStart={() => onDragStart(it.index)}
                      onDragEnd={onDragEnd}
                      onClick={() => {
                        if (readOnly) return;
                        setPopoverIdx(popoverIdx === it.index ? null : it.index);
                      }}
                      showPopover={popoverIdx === it.index && !readOnly}
                      onClosePopover={() => setPopoverIdx(null)}
                      otherClusters={otherClusters}
                      onMoveTo={(toCid) => {
                        setPopoverIdx(null);
                        onMoveStopOut(it.index, toCid);
                      }}
                    />
                  );
              }
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================
 * StopBox — 單個 stop（drag source；drop 由 DropSlot 接手）
 * ========================================================== */
interface StopBoxProps {
  stop: ClusterStop;
  index: number;
  readOnly: boolean;
  /** 是否為當下被拖動的來源站（顯示半透明提示） */
  isDragSource: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
  showPopover: boolean;
  onClosePopover: () => void;
  otherClusters: EditCluster[];
  onMoveTo: (clusterId: string) => void;
}

function StopBox({
  stop, index, readOnly,
  isDragSource, onDragStart, onDragEnd,
  onClick, showPopover, onClosePopover, otherClusters, onMoveTo
}: StopBoxProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [hovering, setHovering] = useState(false);
  const [tipPos, setTipPos] = useState<{ left: number; top: number } | null>(null);
  const [popPos, setPopPos] = useState<{ left: number; top: number } | null>(null);

  const updatePos = (setter: (p: { left: number; top: number }) => void) => {
    if (!boxRef.current) return;
    const rect = boxRef.current.getBoundingClientRect();
    setter({
      left: rect.left + rect.width / 2,
      top:  rect.bottom + window.scrollY + 6
    });
  };

  // 更新 popover 位置（用 mount + resize 修正）
  useEffect(() => {
    if (!showPopover) return;
    updatePos(setPopPos);
    const onScroll = () => updatePos(setPopPos);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [showPopover]);

  return (
    <>
      <div
        ref={boxRef}
        role="button"
        tabIndex={readOnly ? -1 : 0}
        draggable={!readOnly}
        onDragStart={(e) => {
          if (readOnly) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.effectAllowed = "move";
          // 帶上 payload，Firefox 與部分 Chromium 啟動拖動需要
          try { e.dataTransfer.setData("text/plain", String(index)); } catch {}
          // 用 box 本身當 drag image，位置貼到正中間
          if (boxRef.current) {
            const r = boxRef.current.getBoundingClientRect();
            e.dataTransfer.setDragImage(boxRef.current, r.width / 2, r.height / 2);
          }
          // 關掉 hover tooltip，避免拖動中遮擋
          setHovering(false);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onClick={(e) => {
          // 排除 drag 後的合成 click
          if (isDragSource) return;
          onClick();
          e.stopPropagation();
        }}
        onMouseEnter={() => {
          setHovering(true);
          updatePos(setTipPos);
        }}
        onMouseLeave={() => setHovering(false)}
        className={cn(
          "relative flex h-16 min-w-[6.5rem] flex-col items-center justify-center",
          "rounded-md border bg-white px-3 text-sm transition select-none",
          "shrink-0",
          readOnly
            ? "border-slate-200 cursor-default"
            : "border-slate-300 cursor-grab active:cursor-grabbing hover:border-brand-400 hover:shadow-sm",
          isDragSource && "opacity-40 ring-2 ring-brand-300"
        )}
      >
        {/* 編號 */}
        <span className="absolute top-1 left-1 grid size-4 place-items-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
          {index + 1}
        </span>
        {/* drag handle hint */}
        {!readOnly && (
          <GripVertical className="absolute top-1 right-1 size-3 text-slate-300" />
        )}
        {/* 名稱 */}
        <span className="truncate max-w-[6rem] font-medium text-slate-900">
          {stop.stop_name}
        </span>
      </div>

      {/* hover tooltip — portal 到 body，永遠在最上層、不會撐高 strip */}
      {hovering && !showPopover && tipPos && typeof document !== "undefined" && createPortal(
        <div
          className="pointer-events-none fixed z-[9999] w-56 -translate-x-1/2 rounded-md bg-slate-900 px-3 py-2 text-xs text-white shadow-lg"
          style={{ left: tipPos.left, top: tipPos.top }}
        >
          <div className="font-semibold">{stop.stop_name}</div>
          <div className="mt-1 text-slate-300 break-words">
            {stop.stop_address || "（無地址）"}
          </div>
          <div className="mt-1 flex gap-2 text-[11px]">
            {stop.stop_volume != null && (
              <span>📦 {stop.stop_volume} 箱</span>
            )}
            {stop.estimated_service_minutes != null && (
              <span>⏱ {stop.estimated_service_minutes} 分</span>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* click popover — 移到其他路線（也用 portal） */}
      {showPopover && popPos && typeof document !== "undefined" && createPortal(
        <>
          <div
            className="fixed inset-0 z-[9998]"
            onClick={onClosePopover}
          />
          <div
            className="fixed z-[9999] w-60 -translate-x-1/2 rounded-lg border border-slate-200 bg-white shadow-xl"
            style={{ left: popPos.left, top: popPos.top }}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <Move className="size-3" />
                移到其他路線
              </div>
              <button
                onClick={onClosePopover}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="max-h-48 overflow-y-auto p-1">
              {otherClusters.length === 0 ? (
                <p className="px-2 py-3 text-center text-xs text-slate-500">
                  沒有其他路線可移動
                </p>
              ) : (
                otherClusters.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onMoveTo(c.id)}
                    className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-brand-50"
                  >
                    {c.cluster_name}
                    <span className="ml-1 text-xs text-slate-500">
                      ({c.stops.length} 站)
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
}

/* ============================================================
 * DepotNode — 廠房節點（頭尾用實線、中間「回 DC / DC 出」用虛線）
 * ========================================================== */
function DepotNode({ label, dashed = false }: { label: string; dashed?: boolean }) {
  return (
    <div
      className={cn(
        "flex h-16 w-14 flex-col items-center justify-center rounded-md px-2 text-xs shrink-0",
        dashed
          ? "border-2 border-dashed border-amber-400 bg-amber-50 text-amber-800"
          : "border border-slate-300 bg-slate-100 text-slate-600"
      )}
    >
      <Warehouse className="size-3.5" />
      <span className="mt-0.5 font-semibold whitespace-nowrap">{label}</span>
    </div>
  );
}

/* ============================================================
 * TripDivider — Trip 1 / Trip 2 之間的虛線分隔（在「回 DC」與「DC 出」之間）
 * ========================================================== */
function TripDivider() {
  return (
    <div className="relative flex h-16 w-8 items-center justify-center shrink-0">
      <div className="h-full border-l-2 border-dashed border-amber-400" />
      <span className="absolute -top-1 left-1/2 -translate-x-1/2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 whitespace-nowrap">
        第 2 趟
      </span>
    </div>
  );
}

/* ============================================================
 * buildStripItems — 把一條路線攤平成「stable-key 的元素描述列表」。
 *
 * 關鍵：每個 StopBox 用 stop-${route_stop_id} 當 key，即使 cluster.stops
 * 重排（trip 邊界換位置 / 站順序變動），React 也會把舊 DOM 節點認回給
 * 同一個 StopBox，不會 unmount/mount。
 * 拖動中的 source 不被卸載 → native dragend 才能正常觸發、state 才會清乾淨，
 * 後續才能繼續拖。
 * ========================================================== */
type StripItem =
  | { kind: "depot"; key: string; label: string; dashed?: boolean }
  | { kind: "arrow"; key: string; minutes: number | undefined }
  | { kind: "divider"; key: string }
  | { kind: "slot"; key: string; insertAt: number; trip: 1 | 2 }
  | { kind: "stop"; key: string; stop: ClusterStop; index: number };

function buildStripItems({
  stops, depotId, visualBoundary, isDragging, ttMap
}: {
  stops: ClusterStop[];
  depotId: string | null;
  visualBoundary: number;
  isDragging: boolean;
  ttMap: Map<string, number>;
}): StripItem[] {
  const items: StripItem[] = [];
  const N = stops.length;
  const B = visualBoundary;

  if (depotId) items.push({ kind: "depot", key: "dc-start", label: "DC" });

  for (let i = 0; i <= N; i++) {
    const showDivider = i === B && i > 0 && i < N && depotId != null;
    const prevStop = i === 0 ? null : stops[i - 1];
    const curStop  = i < N ? stops[i] : null;

    if (showDivider && prevStop && curStop && depotId) {
      // 左側：trip-1 slot（拖動中）/ 站→DC 箭頭（非拖動）
      if (isDragging) {
        items.push({ kind: "slot", key: `slot-${i}-L`, insertAt: i, trip: 1 });
      } else {
        items.push({
          kind: "arrow",
          key: `ta-back-${i}`,
          minutes: ttMap.get(`${prevStop.stop_id}>${depotId}`)
        });
      }
      items.push({ kind: "depot",   key: `dc-back-${i}`, label: "回 DC", dashed: true });
      items.push({ kind: "divider", key: `div-${i}` });
      items.push({ kind: "depot",   key: `dc-out-${i}`,  label: "DC 出", dashed: true });
      // 右側：trip-2 slot / DC→站 箭頭
      if (isDragging) {
        items.push({ kind: "slot", key: `slot-${i}-R`, insertAt: i, trip: 2 });
      } else {
        items.push({
          kind: "arrow",
          key: `ta-out-${i}`,
          minutes: ttMap.get(`${depotId}>${curStop.stop_id}`)
        });
      }
    } else {
      // 一般位置：拖動中 slot，否則 arrow
      if (isDragging) {
        const trip: 1 | 2 = i < B ? 1 : 2;
        items.push({ kind: "slot", key: `slot-${i}`, insertAt: i, trip });
      } else if (i === 0 && depotId && curStop) {
        items.push({
          kind: "arrow", key: `ta-${i}`,
          minutes: ttMap.get(`${depotId}>${curStop.stop_id}`)
        });
      } else if (i > 0 && i < N && prevStop && curStop) {
        items.push({
          kind: "arrow", key: `ta-${i}`,
          minutes: ttMap.get(`${prevStop.stop_id}>${curStop.stop_id}`)
        });
      } else if (i === N && depotId && prevStop) {
        items.push({
          kind: "arrow", key: `ta-end`,
          minutes: ttMap.get(`${prevStop.stop_id}>${depotId}`)
        });
      }
    }

    if (curStop) {
      items.push({
        kind: "stop",
        key: `stop-${curStop.route_stop_id}`,  // ★ stable key = DB id
        stop: curStop,
        index: i
      });
    }
  }

  if (depotId) items.push({ kind: "depot", key: "dc-end", label: "DC" });

  return items;
}

/* ============================================================
 * DropSlot — 拖動時站與站之間的插入點。
 *  - 寬度恆定 (w-6)，active 時用 absolute overlay 顯示「放開插入」提示；
 *    不會撐開 layout → 避免 native drag 因 layout shift 跟丟。
 *  - 已 active 時不再呼叫 onDragOver，避免每秒幾十次 setState。
 * ========================================================== */
function DropSlot({
  visible, active, onDragOver, onDrop
}: {
  visible: boolean;
  active: boolean;
  onDragOver: () => void;
  onDrop: () => void;
}) {
  if (!visible) return null;
  const handleOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    // 已經 active 就不再 setState，避免每個 dragover frame 都觸發 re-render
    if (!active) onDragOver();
  };
  return (
    <div
      onDragEnter={handleOver}
      onDragOver={handleOver}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className="relative h-16 w-6 shrink-0"
    >
      {active && (
        <div
          className="absolute inset-y-0 -left-1 -right-1 grid place-items-center rounded-md border-2 border-dashed border-brand-500 bg-brand-50 pointer-events-none"
        >
          <span className="text-[10px] font-medium text-brand-600 select-none">
            放開插入
          </span>
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * TravelArrow — 垂直長條 + 右側三角箭頭，比站點 box 短
 * 顏色分級代表時長：≤5 綠 / ≤15 橘 / >15 紅 / 缺資料 灰
 * ========================================================== */
function TravelArrow({ minutes }: { minutes: number | undefined }) {
  const m = minutes;
  const colorClass =
    m == null ? "bg-slate-100 text-slate-400" :
    m <= 5    ? "bg-emerald-100 text-emerald-800" :
    m <= 15   ? "bg-amber-100 text-amber-800" :
                "bg-rose-100 text-rose-800";

  return (
    <div className="flex h-12 items-center shrink-0 mx-1">
      {/* 主體：垂直長條 + 右側三角形（用 clip-path 接成一體）*/}
      <div
        className={cn(
          "relative flex h-12 w-10 flex-col items-center justify-center shadow-sm select-none",
          colorClass
        )}
        style={{
          // 五邊形：左、上左、右上 → 右尖（中點）→ 右下 → 左下
          clipPath: "polygon(0 0, 75% 0, 100% 50%, 75% 100%, 0 100%)"
        }}
      >
        <span className="text-sm font-bold tabular-nums leading-tight pl-0.5 -mr-1">
          {m == null ? "—" : Math.round(m)}
        </span>
        {m != null && (
          <span className="text-[9px] font-medium opacity-70 leading-tight pl-0.5 -mr-1">
            min
          </span>
        )}
      </div>
    </div>
  );
}

/* ============================================================
 * checkMismatch — 班別 / 容量 / 溫層
 * ========================================================== */
function checkMismatch(c: EditCluster, d: DriverOption): string | null {
  if (c.required_shift && d.shift && c.required_shift !== d.shift) {
    return `班別不符（路線需 ${SHIFT_LABEL[c.required_shift as ShiftType]}、物流士 ${SHIFT_LABEL[d.shift as ShiftType]}）`;
  }
  if (c.required_temperature && d.temperature_capability &&
      c.required_temperature !== d.temperature_capability &&
      d.temperature_capability !== "mixed") {
    return `溫層不符（路線需 ${TEMP_LABEL[c.required_temperature as TemperatureType]}、車輛 ${TEMP_LABEL[d.temperature_capability as TemperatureType]}）`;
  }
  const totalVol = c.stops.reduce((s, x) => s + (x.stop_volume ?? 0), 0);
  if (d.vehicle_capacity && totalVol > d.vehicle_capacity * 2) {
    return `容量可能不夠（${totalVol} 箱 vs 車容量 ${d.vehicle_capacity} × 2 趟）`;
  }
  return null;
}

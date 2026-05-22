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
  id: string;
  cluster_name: string;
  assigned_driver_id: string | null;
  required_shift: string | null;
  required_temperature: string | null;
  stops: ClusterStop[];
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

  // 只用於工時計算，UI 上已不再顯示站對站箭頭時間
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
   * insert-only：把第 fromIdx 的 stop 移到 insertAt（0..N），並指定 trip_index。
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

  /* ────────────────────────────────────────────────────────────
   * Pointer-based drag (取代 HTML5 D&D — 之前各種 fix 都失敗)
   *
   *  - StopBox onPointerDown：記下 startX/Y + 註冊 window pointermove/up
   *  - 滑鼠移動超過 threshold 才真正開始拖（避免吃掉 click）
   *  - 拖動中：用 document.elementFromPoint 找游標下的 DropSlot
   *           (DropSlot 上有 data-drop-slot / data-insertat / data-trip)
   *  - 拖動中：一個 fixed 的 Ghost 元件跟著游標
   *  - 放開：若有 dragOverSlot → 呼叫 onInsertStop；不論成功與否，state 全清
   * ──────────────────────────────────────────────────────────── */
  const [dragSrcIdx, setDragSrcIdx] = useState<number | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<DragSlot | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; name: string } | null>(null);

  const visualBoundary = useMemo(() => {
    const i = cluster.stops.findIndex((s) => s.trip_index === 2);
    return i === -1 ? cluster.stops.length : i;
  }, [cluster.stops]);

  const isDragging = dragSrcIdx != null;
  const isSlotActive = (insertAt: number, trip: 1 | 2) =>
    dragOverSlot != null &&
    dragOverSlot.insertAt === insertAt &&
    dragOverSlot.trip === trip;

  // 啟動 drag：在 StopBox 的 pointerdown 觸發
  const beginDrag = (
    srcIdx: number,
    startEvent: React.PointerEvent,
    stopName: string
  ) => {
    if (readOnly) return;
    // 只攔截「左鍵」滑鼠 / 主要 touch
    if (startEvent.button !== 0 && startEvent.pointerType === "mouse") return;

    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    let dragStarted = false;
    let activeSlot: DragSlot | null = null;
    let suppressNextClick = false;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragStarted) {
        // 移動超過 6px 才認定是 drag，避免吃掉純 click
        if (Math.hypot(dx, dy) < 6) return;
        dragStarted = true;
        suppressNextClick = true;
        setDragSrcIdx(srcIdx);
      }
      setGhost({ x: ev.clientX, y: ev.clientY, name: stopName });

      // hit-test：找游標正下方的 DropSlot
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const slotEl = el?.closest("[data-drop-slot]") as HTMLElement | null;
      if (slotEl) {
        const insertAt = Number(slotEl.dataset.insertat);
        const trip = Number(slotEl.dataset.trip);
        if (Number.isFinite(insertAt) && (trip === 1 || trip === 2)) {
          activeSlot = { insertAt, trip: trip as 1 | 2 };
          setDragOverSlot(activeSlot);
        }
      } else {
        activeSlot = null;
        setDragOverSlot(null);
      }
    };

    const onUp = () => {
      if (dragStarted && activeSlot) {
        onInsertStop(srcIdx, activeSlot.insertAt, activeSlot.trip);
      }
      setDragSrcIdx(null);
      setDragOverSlot(null);
      setGhost(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      // 若有 drag，吃掉緊接的 click，避免誤開 popover
      if (suppressNextClick) {
        const swallow = (ev: MouseEvent) => {
          ev.preventDefault();
          ev.stopPropagation();
          window.removeEventListener("click", swallow, true);
        };
        window.addEventListener("click", swallow, true);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // 卸載時保險：把 state 清乾淨
  useEffect(() => () => {
    setDragSrcIdx(null);
    setDragOverSlot(null);
    setGhost(null);
  }, []);

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

        {/* Stop 橫條 */}
        {cluster.stops.length === 0 ? (
          <div className="rounded border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-xs text-slate-400">
            此路線目前無停靠點
          </div>
        ) : (
          <div
            className="flex flex-nowrap items-center gap-1 overflow-x-auto"
            style={{ overflowY: "visible" }}
          >
            {buildStripItems({
              stops: cluster.stops,
              depotId,
              visualBoundary,
              isDragging
            }).map((it) => {
              switch (it.kind) {
                case "depot":
                  return <DepotNode key={it.key} label={it.label} dashed={it.dashed} />;
                case "divider":
                  return <TripDivider key={it.key} />;
                case "slot":
                  return (
                    <DropSlot
                      key={it.key}
                      insertAt={it.insertAt}
                      trip={it.trip}
                      active={isSlotActive(it.insertAt, it.trip)}
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
                      onPointerDown={(e) => beginDrag(it.index, e, it.stop.stop_name)}
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

      {/* 拖動中的 Ghost — fixed + portal，跟著游標 */}
      {ghost && typeof document !== "undefined" && createPortal(
        <div
          className="pointer-events-none fixed z-[9999] -translate-x-1/2 -translate-y-1/2"
          style={{ left: ghost.x, top: ghost.y }}
        >
          <div className="flex h-16 min-w-[6.5rem] items-center justify-center rounded-md border-2 border-brand-400 bg-white px-3 text-sm font-medium text-slate-900 shadow-lg opacity-90">
            <span className="truncate max-w-[7rem]">{ghost.name}</span>
          </div>
        </div>,
        document.body
      )}
    </Card>
  );
}

/* ============================================================
 * StopBox — 單個 stop（drag source by pointerdown；不再用 HTML5 D&D）
 * ========================================================== */
interface StopBoxProps {
  stop: ClusterStop;
  index: number;
  readOnly: boolean;
  isDragSource: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onClick: () => void;
  showPopover: boolean;
  onClosePopover: () => void;
  otherClusters: EditCluster[];
  onMoveTo: (clusterId: string) => void;
}

function StopBox({
  stop, index, readOnly,
  isDragSource, onPointerDown,
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
        onPointerDown={(e) => {
          // 拖動中的 source 用 opacity 隱形，pointer events 停掉避免 hit-test 自己
          if (readOnly) return;
          onPointerDown(e);
        }}
        onClick={onClick}
        onMouseEnter={() => {
          if (isDragSource) return;
          setHovering(true);
          updatePos(setTipPos);
        }}
        onMouseLeave={() => setHovering(false)}
        className={cn(
          "relative flex h-16 min-w-[6.5rem] flex-col items-center justify-center",
          "rounded-md border bg-white px-3 text-sm transition select-none",
          "shrink-0 touch-none",  // touch-none 讓 pointer events 不被 touch scroll 吃掉
          readOnly
            ? "border-slate-200 cursor-default"
            : "border-slate-300 cursor-grab active:cursor-grabbing hover:border-brand-400 hover:shadow-sm",
          isDragSource && "opacity-30 ring-2 ring-brand-300 pointer-events-none"
        )}
      >
        <span className="absolute top-1 left-1 grid size-4 place-items-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
          {index + 1}
        </span>
        {!readOnly && (
          <GripVertical className="absolute top-1 right-1 size-3 text-slate-300" />
        )}
        <span className="truncate max-w-[6rem] font-medium text-slate-900">
          {stop.stop_name}
        </span>
      </div>

      {/* hover tooltip — portal 到 body */}
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

      {/* click popover — 移到其他路線 */}
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
 * DepotNode — 廠房節點
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
 * TripDivider — Trip 1 / Trip 2 之間的虛線分隔
 * ========================================================== */
function TripDivider() {
  return (
    <div className="relative flex h-16 w-6 items-center justify-center shrink-0">
      <div className="h-full border-l-2 border-dashed border-amber-400" />
      <span className="absolute -top-1 left-1/2 -translate-x-1/2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 whitespace-nowrap">
        第 2 趟
      </span>
    </div>
  );
}

/* ============================================================
 * buildStripItems — flat list with stable keys。
 * 已移除 arrow（站對站時間）。
 * ========================================================== */
type StripItem =
  | { kind: "depot"; key: string; label: string; dashed?: boolean }
  | { kind: "divider"; key: string }
  | { kind: "slot"; key: string; insertAt: number; trip: 1 | 2 }
  | { kind: "stop"; key: string; stop: ClusterStop; index: number };

function buildStripItems({
  stops, depotId, visualBoundary, isDragging
}: {
  stops: ClusterStop[];
  depotId: string | null;
  visualBoundary: number;
  isDragging: boolean;
}): StripItem[] {
  const items: StripItem[] = [];
  const N = stops.length;
  const B = visualBoundary;

  if (depotId) items.push({ kind: "depot", key: "dc-start", label: "DC" });

  for (let i = 0; i <= N; i++) {
    const showDivider = i === B && i > 0 && i < N && depotId != null;

    if (showDivider) {
      // 左側 slot（拖動才出現）
      if (isDragging) {
        items.push({ kind: "slot", key: `slot-${i}-L`, insertAt: i, trip: 1 });
      }
      items.push({ kind: "depot",   key: `dc-back-${i}`, label: "回 DC", dashed: true });
      items.push({ kind: "divider", key: `div-${i}` });
      items.push({ kind: "depot",   key: `dc-out-${i}`,  label: "DC 出", dashed: true });
      // 右側 slot
      if (isDragging) {
        items.push({ kind: "slot", key: `slot-${i}-R`, insertAt: i, trip: 2 });
      }
    } else if (isDragging) {
      // 一般位置：拖動中放 slot
      const trip: 1 | 2 = i < B ? 1 : 2;
      items.push({ kind: "slot", key: `slot-${i}`, insertAt: i, trip });
    }

    if (i < N) {
      const s = stops[i];
      items.push({
        kind: "stop",
        key: `stop-${s.route_stop_id}`,  // ★ stable key
        stop: s,
        index: i
      });
    }
  }

  if (depotId) items.push({ kind: "depot", key: "dc-end", label: "DC" });

  return items;
}

/* ============================================================
 * DropSlot — 拖動時站與站之間的插入點
 *  - 用 data-* 屬性 + elementFromPoint 做 hit-test
 *  - 寬度恆定，active 用 overlay；不會撐開 layout
 * ========================================================== */
function DropSlot({
  insertAt, trip, active
}: {
  insertAt: number;
  trip: 1 | 2;
  active: boolean;
}) {
  return (
    <div
      data-drop-slot=""
      data-insertat={insertAt}
      data-trip={trip}
      className="relative h-16 w-6 shrink-0"
    >
      {active && (
        <div className="absolute inset-y-0 -left-1 -right-1 grid place-items-center rounded-md border-2 border-dashed border-brand-500 bg-brand-50 pointer-events-none">
          <span className="text-[10px] font-medium text-brand-600 select-none">
            放開插入
          </span>
        </div>
      )}
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

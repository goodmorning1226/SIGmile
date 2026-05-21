"use client";

import { Fragment, useMemo, useState, useTransition, useRef, useEffect } from "react";
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
   * insert-only：把第 fromIdx 的 stop 移到 slot 位置（0..N）。
   * 同時依「captured 分隔線位置 boundaryAtDragStart」決定新的 trip_index。
   */
  const insertStopAtSlot = (
    cid: string,
    fromIdx: number,
    slot: number,
    boundaryAtDragStart: number
  ) => {
    setClusters((cs) => cs.map((c) => {
      if (c.id !== cid) return c;
      const newTrip: 1 | 2 = slot < boundaryAtDragStart ? 1 : 2;
      const arr = [...c.stops];
      const [moved] = arr.splice(fromIdx, 1);
      // 移除後重算 insertAt
      const insertAt = slot > fromIdx ? slot - 1 : slot;
      arr.splice(insertAt, 0, { ...moved, trip_index: newTrip });
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
            onInsertStop={(from, slot, boundary) =>
              insertStopAtSlot(c.id, from, slot, boundary)
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
  /** insert-only：fromIdx 的 stop 移到 slot；boundary 是 drag 開始時擷取的 trip 分隔線 */
  onInsertStop: (fromIdx: number, slot: number, boundary: number) => void;
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
  //  - dragOverSlot：滑鼠當下 hover 的「插入槽」index（0 = 第一站之前；N = 最後一站之後）
  //  - dragBoundary：drag 開始時 capture 的 trip 分隔線位置（拖動時保持不變）
  const [dragSrcIdx, setDragSrcIdx] = useState<number | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<number | null>(null);
  const [dragBoundary, setDragBoundary] = useState<number | null>(null);

  // 自然 trip 分隔線位置 = 第一個 trip_index==2 的 index；都是 trip-1 則回 stops.length
  const naturalBoundary = useMemo(() => {
    const i = cluster.stops.findIndex((s) => s.trip_index === 2);
    return i === -1 ? cluster.stops.length : i;
  }, [cluster.stops]);

  // 拖動中以 capture 的為主；沒拖動則用自然位置
  const visualBoundary = dragBoundary ?? naturalBoundary;
  const isDragging = dragSrcIdx != null;

  const onDragStart = (srcIdx: number) => {
    setDragSrcIdx(srcIdx);
    setDragBoundary(naturalBoundary);
  };
  const onDragEnd = () => {
    setDragSrcIdx(null);
    setDragOverSlot(null);
    setDragBoundary(null);
  };
  const onDropAtSlot = (slot: number) => {
    if (dragSrcIdx == null || dragBoundary == null) {
      onDragEnd();
      return;
    }
    onInsertStop(dragSrcIdx, slot, dragBoundary);
    onDragEnd();
  };

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
            {/* depot start */}
            {depotId && <DepotNode label="DC" />}

            {/* slot 0：最前面（拖動時才顯示） */}
            <DropSlot
              visible={isDragging}
              active={dragOverSlot === 0}
              onDragOver={() => setDragOverSlot(0)}
              onDrop={() => onDropAtSlot(0)}
            />

            {cluster.stops.map((s, si) => {
              const prevStop  = si === 0 ? null : cluster.stops[si - 1];
              const prevId    = prevStop?.stop_id ?? depotId;
              // trip 分隔線位置 = visualBoundary，固定不會隨拖動移動
              const isTripBreakHere = visualBoundary === si && si > 0 && depotId != null;

              return (
                <Fragment key={s.route_stop_id}>
                  {/* 一日二配邊界：上一站 → 回 DC → 分隔線 → DC 出 → 下一站 */}
                  {isTripBreakHere && prevStop && depotId && (
                    <>
                      {!isDragging && (
                        <TravelArrow minutes={ttMap.get(`${prevStop.stop_id}>${depotId}`)} />
                      )}
                      <DepotNode label="回 DC" dashed />
                      <TripDivider />
                      <DepotNode label="DC 出" dashed />
                      {!isDragging && (
                        <TravelArrow minutes={ttMap.get(`${depotId}>${s.stop_id}`)} />
                      )}
                    </>
                  )}

                  {/* 一般站間箭頭（非 trip break、非拖動中才顯示時間） */}
                  {!isTripBreakHere && !isDragging && (depotId || si > 0) && (
                    <TravelArrow minutes={prevId ? ttMap.get(`${prevId}>${s.stop_id}`) : undefined} />
                  )}

                  <StopBox
                    stop={s}
                    index={si}
                    readOnly={readOnly}
                    isDragSource={dragSrcIdx === si}
                    onDragStart={() => onDragStart(si)}
                    onDragEnd={onDragEnd}
                    onClick={() => {
                      if (readOnly) return;
                      setPopoverIdx(popoverIdx === si ? null : si);
                    }}
                    showPopover={popoverIdx === si && !readOnly}
                    onClosePopover={() => setPopoverIdx(null)}
                    otherClusters={otherClusters}
                    onMoveTo={(toCid) => {
                      setPopoverIdx(null);
                      onMoveStopOut(si, toCid);
                    }}
                  />

                  {/* 每個站後面都接一個 drop slot（拖動時才顯示） */}
                  <DropSlot
                    visible={isDragging}
                    active={dragOverSlot === si + 1}
                    onDragOver={() => setDragOverSlot(si + 1)}
                    onDrop={() => onDropAtSlot(si + 1)}
                  />
                </Fragment>
              );
            })}

            {/* depot end */}
            {depotId && (
              <>
                {!isDragging && (
                  <TravelArrow
                    minutes={ttMap.get(`${cluster.stops[cluster.stops.length - 1].stop_id}>${depotId}`)}
                  />
                )}
                <DepotNode label="DC" />
              </>
            )}
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
  const btnRef = useRef<HTMLButtonElement>(null);
  const [hovering, setHovering] = useState(false);
  const [tipPos, setTipPos] = useState<{ left: number; top: number } | null>(null);
  const [popPos, setPopPos] = useState<{ left: number; top: number } | null>(null);

  const updatePos = (setter: (p: { left: number; top: number }) => void) => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
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
      <button
        ref={btnRef}
        type="button"
        draggable={!readOnly}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          // 設一些 payload 才能在某些瀏覽器啟動拖動
          try { e.dataTransfer.setData("text/plain", String(index)); } catch {}
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onClick={onClick}
        onMouseEnter={() => {
          setHovering(true);
          updatePos(setTipPos);
        }}
        onMouseLeave={() => setHovering(false)}
        className={cn(
          "relative flex h-16 min-w-[6.5rem] flex-col items-center justify-center",
          "rounded-md border bg-white px-3 text-sm transition",
          "shrink-0",
          readOnly
            ? "border-slate-200 cursor-default"
            : "border-slate-300 cursor-pointer hover:border-brand-400 hover:shadow-sm",
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
      </button>

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
 * DropSlot — 拖動時站與站之間的虛線插入格
 *  - visible=false 完全不渲染
 *  - active=true（滑鼠 hover 此 slot）→ 展開顯示虛線格
 *  - active=false → 維持很細的觸發區，使滑鼠掃過時可以切換 active slot
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
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      className={cn(
        "h-16 flex items-center justify-center transition-all shrink-0",
        active
          ? "w-[6.5rem] mx-1 rounded-md border-2 border-dashed border-brand-500 bg-brand-50"
          : "w-3"
      )}
    >
      {active && (
        <span className="text-[10px] font-medium text-brand-600 select-none">
          放開插入
        </span>
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

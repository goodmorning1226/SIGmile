"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronUp, ChevronDown, ArrowLeftRight, Save, RotateCcw, Plus,
  Combine, Split, Trash2, Edit3, Check
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import type { ClusterRow, ClusterStop, PlanForEdit } from "@/lib/services/cluster-service";

/* ============================================================
 * 編輯狀態（純前端 in-memory，按「儲存」才送 server）
 * ========================================================== */
interface EditCluster {
  id: string;                  // local id（可能是 server id 也可能是 'new-xxx'）
  cluster_name: string;
  stops: ClusterStop[];        // 順序 = stop_order
}

function fromServer(plan: PlanForEdit): EditCluster[] {
  return plan.clusters.map((c) => ({
    id: c.id,
    cluster_name: c.cluster_name,
    stops: [...c.stops].sort((a, b) => a.stop_order - b.stop_order)
  }));
}

let newClusterCounter = 0;
function makeNewCluster(name = "新群組"): EditCluster {
  newClusterCounter += 1;
  return { id: `new-${Date.now()}-${newClusterCounter}`, cluster_name: name, stops: [] };
}

/* ============================================================
 * Editor 主元件
 * ========================================================== */
export function ClusterEditor({
  plan, readOnly = false
}: {
  plan: PlanForEdit;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [clusters, setClusters] = useState<EditCluster[]>(() => fromServer(plan));
  const [unclustered, setUnclustered] = useState<ClusterStop[]>(plan.unclustered_stops);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = useMemo(() => {
    return JSON.stringify(clusters) !== JSON.stringify(fromServer(plan)) ||
           unclustered.length !== plan.unclustered_stops.length;
  }, [clusters, unclustered, plan]);

  /* ───── actions ───── */
  const renameCluster = (cid: string, name: string) => {
    setClusters((cs) => cs.map((c) => c.id === cid ? { ...c, cluster_name: name } : c));
  };

  const addCluster = () => {
    setClusters((cs) => [...cs, makeNewCluster(`群組 ${cs.length + 1}`)]);
  };

  const removeCluster = (cid: string) => {
    // 把該 cluster 的 stops 退回 unclustered
    setClusters((cs) => {
      const c = cs.find((x) => x.id === cid);
      if (c) setUnclustered((u) => [...u, ...c.stops]);
      return cs.filter((x) => x.id !== cid);
    });
  };

  const moveClusterUp = (idx: number) => {
    if (idx <= 0) return;
    setClusters((cs) => {
      const arr = [...cs];
      [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
      return arr;
    });
  };
  const moveClusterDown = (idx: number) => {
    setClusters((cs) => {
      if (idx >= cs.length - 1) return cs;
      const arr = [...cs];
      [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
      return arr;
    });
  };

  const moveStopUp = (cid: string, sIdx: number) => {
    setClusters((cs) => cs.map((c) => {
      if (c.id !== cid) return c;
      if (sIdx <= 0) return c;
      const arr = [...c.stops];
      [arr[sIdx - 1], arr[sIdx]] = [arr[sIdx], arr[sIdx - 1]];
      return { ...c, stops: arr };
    }));
  };
  const moveStopDown = (cid: string, sIdx: number) => {
    setClusters((cs) => cs.map((c) => {
      if (c.id !== cid) return c;
      if (sIdx >= c.stops.length - 1) return c;
      const arr = [...c.stops];
      [arr[sIdx + 1], arr[sIdx]] = [arr[sIdx], arr[sIdx + 1]];
      return { ...c, stops: arr };
    }));
  };

  const moveStopToCluster = (fromCid: string, sIdx: number, toCid: string) => {
    setClusters((cs) => {
      const fromC = cs.find((c) => c.id === fromCid);
      if (!fromC) return cs;
      const stop = fromC.stops[sIdx];
      if (!stop) return cs;
      return cs.map((c) => {
        if (c.id === fromCid) {
          return { ...c, stops: c.stops.filter((_, i) => i !== sIdx) };
        }
        if (c.id === toCid) {
          return { ...c, stops: [...c.stops, stop] };
        }
        return c;
      });
    });
  };

  const moveStopFromUnclustered = (stopIdx: number, toCid: string) => {
    setUnclustered((u) => {
      const stop = u[stopIdx];
      if (!stop) return u;
      setClusters((cs) => cs.map((c) =>
        c.id === toCid ? { ...c, stops: [...c.stops, stop] } : c
      ));
      return u.filter((_, i) => i !== stopIdx);
    });
  };

  const splitCluster = (cid: string) => {
    setClusters((cs) => {
      const idx = cs.findIndex((c) => c.id === cid);
      if (idx < 0) return cs;
      const c = cs[idx];
      if (c.stops.length < 2) return cs;
      const half = Math.ceil(c.stops.length / 2);
      const newC = makeNewCluster(`${c.cluster_name}（拆分）`);
      newC.stops = c.stops.slice(half);
      const arr = [...cs];
      arr[idx] = { ...c, stops: c.stops.slice(0, half) };
      arr.splice(idx + 1, 0, newC);
      return arr;
    });
  };

  const reset = () => {
    setClusters(fromServer(plan));
    setUnclustered(plan.unclustered_stops);
    setSavedAt(null);
    setError(null);
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        const payload = {
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
        const res = await fetch("/api/manager/clusters/save", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
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

  /* ───── 不在任何 cluster 的孤兒 stop 區塊 ───── */
  const renderUnclustered = () => {
    if (unclustered.length === 0) return null;
    if (readOnly) return null; // 已發布版本不顯示「未分群」概念
    return (
      <Card className="border-amber-200 bg-amber-50/30">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-amber-800">尚未分群的停靠點</CardTitle>
            <Badge tone="warning">{unclustered.length}</Badge>
          </div>
          <CardDescription>
            這些站還沒被分到任何群組。把它們指派到下方某個群組，或先建一個新群組再丟進去。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {unclustered.map((s, idx) => (
            <div
              key={s.route_stop_id}
              className="flex items-center gap-3 rounded-md border border-amber-200 bg-white px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-900">
                  {s.stop_name}
                </div>
                <div className="truncate text-xs text-slate-500">
                  {s.stop_address}
                  {s.stop_city && <> · {s.stop_city}{s.stop_district ?? ""}</>}
                </div>
              </div>
              <select
                className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm"
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    moveStopFromUnclustered(idx, e.target.value);
                  }
                }}
              >
                <option value="">移到 …</option>
                {clusters.map((c) => (
                  <option key={c.id} value={c.id}>{c.cluster_name}</option>
                ))}
              </select>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  };

  /* ───── render ───── */
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 -mx-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/95 px-2 py-2 backdrop-blur ring-1 ring-slate-200">
        <div className="flex items-center gap-2">
          {!readOnly && (
            <Button variant="outline" size="sm" onClick={addCluster}>
              <Plus className="size-3.5" /> 新增群組
            </Button>
          )}
          <span className="text-xs text-slate-500">
            共 {clusters.length} 群、{clusters.reduce((sum, c) => sum + c.stops.length, 0)} 站
          </span>
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
            <Button
              size="sm"
              onClick={save}
              disabled={!dirty}
              loading={pending}
            >
              <Save className="size-3.5" /> 儲存編輯
            </Button>
          </div>
        )}
      </div>

      {renderUnclustered()}

      {/* Clusters list */}
      {clusters.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">
            尚無群組。按右上方「新增群組」開始，或先到「發布新路線」跑一次規劃自動產生群組。
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {clusters.map((c, ci) => (
            <ClusterCard
              key={c.id}
              cluster={c}
              index={ci}
              totalClusters={clusters.length}
              allClusters={clusters}
              readOnly={readOnly}
              editingName={editingNameId === c.id}
              onStartRename={() => setEditingNameId(c.id)}
              onStopRename={() => setEditingNameId(null)}
              onRename={(n) => renameCluster(c.id, n)}
              onMoveUp={() => moveClusterUp(ci)}
              onMoveDown={() => moveClusterDown(ci)}
              onRemove={() => removeCluster(c.id)}
              onSplit={() => splitCluster(c.id)}
              onMoveStopUp={(si) => moveStopUp(c.id, si)}
              onMoveStopDown={(si) => moveStopDown(c.id, si)}
              onMoveStopTo={(si, toCid) => moveStopToCluster(c.id, si, toCid)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * ClusterCard
 * ========================================================== */
interface ClusterCardProps {
  cluster: EditCluster;
  index: number;
  totalClusters: number;
  allClusters: EditCluster[];
  readOnly?: boolean;
  editingName: boolean;
  onStartRename: () => void;
  onStopRename: () => void;
  onRename: (name: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onSplit: () => void;
  onMoveStopUp: (sIdx: number) => void;
  onMoveStopDown: (sIdx: number) => void;
  onMoveStopTo: (sIdx: number, toClusterId: string) => void;
}

function ClusterCard({
  cluster, index, totalClusters, allClusters, readOnly = false,
  editingName, onStartRename, onStopRename, onRename,
  onMoveUp, onMoveDown, onRemove, onSplit,
  onMoveStopUp, onMoveStopDown, onMoveStopTo
}: ClusterCardProps) {
  const otherClusters = allClusters.filter((c) => c.id !== cluster.id);
  const totalVolume = cluster.stops.reduce((s, x) => s + (x.stop_volume ?? 0), 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
              {index + 1}
            </div>
            {editingName && !readOnly ? (
              <Input
                autoFocus
                defaultValue={cluster.cluster_name}
                onBlur={(e) => { onRename(e.target.value); onStopRename(); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") onStopRename();
                }}
                className="h-9 w-60"
              />
            ) : readOnly ? (
              <span className="truncate text-base font-semibold text-slate-900">
                {cluster.cluster_name}
              </span>
            ) : (
              <button
                onClick={onStartRename}
                className="group flex min-w-0 items-center gap-2 text-left"
              >
                <span className="truncate text-base font-semibold text-slate-900">
                  {cluster.cluster_name}
                </span>
                <Edit3 className="size-3.5 shrink-0 text-slate-300 group-hover:text-slate-600" />
              </button>
            )}
            <Badge tone="neutral">{cluster.stops.length} 站</Badge>
            {totalVolume > 0 && (
              <span className="text-xs text-slate-500">
                約 {totalVolume} 箱
              </span>
            )}
          </div>

          {!readOnly && (
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={onMoveUp}
                disabled={index === 0}
                className="grid size-7 place-items-center rounded border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-30"
                title="群組上移"
              >
                <ChevronUp className="size-4" />
              </button>
              <button
                onClick={onMoveDown}
                disabled={index === totalClusters - 1}
                className="grid size-7 place-items-center rounded border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-30"
                title="群組下移"
              >
                <ChevronDown className="size-4" />
              </button>
              <Button
                size="sm"
                variant="outline"
                onClick={onSplit}
                disabled={cluster.stops.length < 2}
                title="把這個群組從中間切成兩個"
              >
                <Split className="size-3.5" /> 拆分
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onRemove}
                className="text-red-600 hover:bg-red-50"
                title="刪除群組（站點會退回未分群）"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {cluster.stops.length === 0 ? (
          <div className="border-t border-slate-100 px-6 py-6 text-center text-sm text-slate-400">
            尚無停靠點。從上方「未分群」或其他群組移動站點進來。
          </div>
        ) : (
          <ol className="divide-y divide-slate-100">
            {cluster.stops.map((s, si) => (
              <li key={s.route_stop_id} className="flex items-center gap-3 px-6 py-2.5">
                <div className="grid size-7 shrink-0 place-items-center rounded-full border border-slate-200 bg-slate-50 text-xs font-semibold tabular-nums text-slate-700">
                  {si + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-900">
                      {s.stop_name}
                    </span>
                    {s.trip_index === 2 && (
                      <Badge tone="info">第 2 趟</Badge>
                    )}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {s.stop_address}
                    {s.stop_city && <> · {s.stop_city}{s.stop_district ?? ""}</>}
                    {s.stop_volume && <> · {s.stop_volume} 箱</>}
                  </div>
                </div>

                {!readOnly && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => onMoveStopUp(si)}
                      disabled={si === 0}
                      className="grid size-6 place-items-center rounded border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:opacity-30"
                    >
                      <ChevronUp className="size-3.5" />
                    </button>
                    <button
                      onClick={() => onMoveStopDown(si)}
                      disabled={si === cluster.stops.length - 1}
                      className="grid size-6 place-items-center rounded border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:opacity-30"
                    >
                      <ChevronDown className="size-3.5" />
                    </button>
                    {otherClusters.length > 0 && (
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value) onMoveStopTo(si, e.target.value);
                        }}
                        className="h-6 rounded border border-slate-200 bg-white px-1 text-xs"
                        title="移到其他群組"
                      >
                        <option value="">↔</option>
                        {otherClusters.map((oc) => (
                          <option key={oc.id} value={oc.id}>→ {oc.cluster_name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

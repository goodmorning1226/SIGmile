"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Layers, ChevronDown, ChevronUp, Truck, Clock, Route as RouteIcon, Send, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { OrInputForm, parseOrInputParams } from "./OrInputForm";

interface JobRow {
  id: string;
  planning_period_id: string;
  status: string;
  engine_version: string | null;
  input_parameters: Record<string, unknown>;
  output_plan: Record<string, unknown>;
  created_route_plan_id: string | null;
  created_at: string;
  completed_at: string | null;
}

interface OutputCluster {
  cluster_name: string;
  sequence: number;
  required_shift?: string;
  required_temperature?: string;
  estimated_total_minutes: number;
  estimated_total_distance_meters: number;
  estimated_total_volume: number;
  suggested_driver_id?: string | null;
  trips: Array<{
    trip_index: number;
    stops: Array<{
      stop_id: string;
      stop_order: number;
      estimated_arrival_time: string;
      estimated_service_minutes: number;
      estimated_volume?: number;
    }>;
  }>;
}

export function OrJobList({ jobs }: { jobs: JobRow[] }) {
  if (jobs.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-slate-500">
        尚無規劃任務。按右上方「建立新規劃任務」開始。
      </div>
    );
  }
  return (
    <ul className="divide-y divide-slate-100">
      {jobs.map((j) => <JobRow key={j.id} job={j} />)}
    </ul>
  );
}

type RunKind = "mock-run" | "real-run" | "materialize" | "materialize-and-publish";

function JobRow({ job }: { job: JobRow }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<RunKind | null>(null);

  const hasOutput = job.output_plan && Object.keys(job.output_plan).length > 0;
  const isCompleted = job.status === "completed";
  const isMaterialized = !!job.created_route_plan_id;

  const handleAction = (kind: RunKind) => {
    if (kind === "materialize-and-publish") {
      if (!confirm("確定要採用此結果並立即發布給物流士嗎？\n發布後，同期間舊版本會自動封存。")) {
        return;
      }
    }
    if (kind === "real-run") {
      if (!confirm("跑真實 Gurobi 求解器可能需要 10 秒 ~ 數分鐘，過程中請勿關閉視窗。確認繼續？")) {
        return;
      }
    }
    setRunning(kind);
    startTransition(async () => {
      const res = await fetch(`/api/manager/or-jobs/${job.id}/${kind}`, { method: "POST" });
      const j = await res.json();
      if (!j.ok) {
        alert(j.error?.message ?? "操作失敗");
      } else if (kind === "real-run" && j.data?.engine_used === "mock-fallback") {
        const reason = j.data?.fallback_reason ?? "（沒有提供原因）";
        const diag = j.data?.diagnostics
          ? "\n\n診斷資訊：\n" + JSON.stringify(j.data.diagnostics, null, 2)
          : "";
        alert(
          "⚠️ Gurobi engine 不可用，已 fallback 跑 mock。\n" +
          "失敗原因：" + reason +
          diag +
          "\n\n設定步驟見 or-engine/README.md。"
        );
      }
      router.refresh();
      setRunning(null);
    });
  };

  const output = (job.output_plan ?? {}) as Record<string, any>;
  const summary = output.summary as
    | { total_clusters?: number; total_stops?: number;
        total_estimated_minutes?: number; drivers_dispatched?: number; }
    | undefined;
  const clusters: OutputCluster[] = (output.clusters ?? []) as OutputCluster[];
  const inputParams = parseOrInputParams(job.input_parameters);

  const createdAt = new Date(job.created_at).toLocaleString("zh-TW", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  });

  return (
    <li className="px-6 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-800">
              規劃任務 #{job.id.slice(0, 6)}
            </span>
            <StatusBadge status={job.status as any} />
            {job.engine_version && (
              <Badge tone={job.engine_version.startsWith("gurobi") ? "success" : "info"}>
                {job.engine_version}
              </Badge>
            )}
            {isMaterialized && <Badge tone="success">已轉成路線</Badge>}
          </div>

          <div className="mt-1.5 text-xs text-slate-500">
            建立於 {createdAt}
            {job.completed_at && (
              <>
                {" · "}
                完成於 {new Date(job.completed_at).toLocaleString("zh-TW", {
                  month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
                })}
              </>
            )}
          </div>

          {summary && (
            <div className="mt-2.5 flex flex-wrap gap-3 text-xs">
              <Stat icon={<Truck className="size-3.5" />} label="出動物流士" value={summary.drivers_dispatched} />
              <Stat icon={<Layers className="size-3.5" />} label="路線集" value={summary.total_clusters} />
              <Stat icon={<RouteIcon className="size-3.5" />} label="總站數" value={summary.total_stops} />
              <Stat icon={<Clock className="size-3.5" />} label="預估總工時" value={summary.total_estimated_minutes} unit="分鐘" />
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!isCompleted && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleAction("mock-run")}
                loading={pending && running === "mock-run"}
                title="用內建演算法快速試算（不用 Gurobi）"
              >
                <Play className="size-3.5" />
                Mock 試算
              </Button>
              <Button
                size="sm"
                onClick={() => handleAction("real-run")}
                loading={pending && running === "real-run"}
                title="呼叫 Python Gurobi 求最佳解（需要本機已安裝 or-engine）"
              >
                <Cpu className="size-3.5" />
                Gurobi 試算
              </Button>
            </>
          )}
          {isCompleted && hasOutput && !isMaterialized && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleAction("materialize")}
                loading={pending && running === "materialize"}
              >
                <Layers className="size-3.5" />
                採用此結果
              </Button>
              <Button
                size="sm"
                variant="success"
                onClick={() => handleAction("materialize-and-publish")}
                loading={pending && running === "materialize-and-publish"}
              >
                <Send className="size-3.5" />
                採用並發布
              </Button>
            </>
          )}
          <Button size="sm" variant="outline" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            {expanded ? "收合" : "明細"}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-4 rounded-lg border border-slate-200 bg-slate-50/40 p-4">
          {/* 規劃條件 */}
          <details open className="group">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700 marker:text-slate-400">
              規劃條件
            </summary>
            <div className="mt-3">
              <OrInputForm value={inputParams} onChange={() => {}} readOnly />
            </div>
          </details>

          {/* 試算結果 */}
          {hasOutput && clusters.length > 0 && (
            <details open className="group">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700 marker:text-slate-400">
                試算結果（{clusters.length} 條路線集）
              </summary>
              <div className="mt-3 space-y-2">
                {clusters.map((c) => (
                  <div
                    key={`${c.sequence}-${c.cluster_name}`}
                    className="rounded-md border border-slate-200 bg-white p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <Truck className="size-4 text-brand-500" />
                        {c.cluster_name}
                      </div>
                      <div className="text-xs text-slate-500">
                        {c.trips.reduce((s, t) => s + t.stops.length, 0)} 站 ·
                        預估 {c.estimated_total_minutes} 分鐘 ·
                        貨量 {c.estimated_total_volume} 箱
                      </div>
                    </div>
                    {c.trips.map((trip) => (
                      <div key={trip.trip_index} className="mt-2">
                        <div className="text-[11px] font-semibold text-slate-500">
                          第 {trip.trip_index} 趟（{trip.stops.length} 站）
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {trip.stops.map((s) => (
                            <span
                              key={`${trip.trip_index}-${s.stop_order}`}
                              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs"
                            >
                              <span className="grid size-4 place-items-center rounded-full bg-brand-500 text-[10px] font-semibold text-white">
                                {s.stop_order}
                              </span>
                              <span className="text-slate-500">{s.estimated_arrival_time}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </details>
          )}

          {hasOutput && clusters.length === 0 && (
            <p className="text-sm text-slate-500">此次試算未產生任何可行路線集（可能 stop / driver 資料不足）。</p>
          )}
          {!hasOutput && (
            <p className="text-sm text-slate-500">
              此任務尚未試算，按上方「Mock 試算」或「Gurobi 試算」開始。
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function Stat({
  icon, label, value, unit
}: {
  icon?: React.ReactNode;
  label: string;
  value: number | undefined;
  unit?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1 ring-1 ring-slate-200">
      {icon}
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold tabular-nums text-slate-800">
        {value ?? "—"}
      </span>
      {unit && <span className="text-slate-400">{unit}</span>}
    </span>
  );
}

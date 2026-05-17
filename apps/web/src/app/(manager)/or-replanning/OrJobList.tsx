"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Layers, ChevronDown, ChevronUp, Truck, Clock, Route as RouteIcon, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { OrInputForm, parseOrInputParams, OBJECTIVE_LABEL } from "./OrInputForm";

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

interface OutputDriver {
  driver_id: string;
  route_name: string;
  estimated_total_minutes: number;
  estimated_total_distance_meters: number;
  stops: Array<{
    stop_id: string;
    stop_order: number;
    estimated_arrival_time: string;
    estimated_service_minutes: number;
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

function JobRow({ job }: { job: JobRow }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<"mock-run" | "materialize" | "materialize-and-publish" | null>(null);

  const hasOutput = job.output_plan && Object.keys(job.output_plan).length > 0;
  const isCompleted = job.status === "completed";
  const isMaterialized = !!job.created_route_plan_id;

  const handleAction = (kind: "mock-run" | "materialize" | "materialize-and-publish") => {
    if (kind === "materialize-and-publish") {
      if (!confirm("確定要採用此結果並立即發布給物流士嗎？\n發布後，同期間舊版本會自動封存。")) {
        return;
      }
    }
    setRunning(kind);
    startTransition(async () => {
      const res = await fetch(`/api/manager/or-jobs/${job.id}/${kind}`, { method: "POST" });
      const j = await res.json();
      if (!j.ok) alert(j.error?.message ?? "操作失敗");
      router.refresh();
      setRunning(null);
    });
  };

  const summary = (job.output_plan as any)?.summary as
    | { total_drivers?: number; total_stops?: number; total_estimated_minutes?: number }
    | undefined;
  const drivers = ((job.output_plan as any)?.drivers ?? []) as OutputDriver[];
  const inputParams = parseOrInputParams(job.input_parameters);

  // 建立時間 display
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
            {isMaterialized && (
              <Badge tone="success">已轉成路線</Badge>
            )}
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
              <Stat icon={<Truck className="size-3.5" />} label="物流士" value={summary.total_drivers} />
              <Stat icon={<RouteIcon className="size-3.5" />} label="總站數" value={summary.total_stops} />
              <Stat icon={<Clock className="size-3.5" />} label="預估總工時" value={summary.total_estimated_minutes} unit="分鐘" />
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!isCompleted && (
            <Button
              size="sm"
              onClick={() => handleAction("mock-run")}
              loading={pending && running === "mock-run"}
            >
              <Play className="size-3.5" />
              試算
            </Button>
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
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                <span>優化目標：</span>
                <Badge tone="info">{OBJECTIVE_LABEL[inputParams.objective]}</Badge>
              </div>
            </div>
          </details>

          {/* 試算結果 */}
          {hasOutput && drivers.length > 0 && (
            <details open className="group">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700 marker:text-slate-400">
                試算結果
              </summary>
              <div className="mt-3 space-y-2">
                {drivers.map((d, i) => (
                  <div
                    key={i}
                    className="rounded-md border border-slate-200 bg-white p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        <Truck className="size-4 text-brand-500" />
                        路線 {d.route_name}
                      </div>
                      <div className="text-xs text-slate-500">
                        共 {d.stops.length} 站 · 預估 {d.estimated_total_minutes} 分鐘 · {(d.estimated_total_distance_meters / 1000).toFixed(1)} 公里
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {d.stops.map((s) => (
                        <span
                          key={`${d.driver_id}-${s.stop_order}`}
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
            </details>
          )}

          {hasOutput && drivers.length === 0 && (
            <p className="text-sm text-slate-500">尚無分配結果</p>
          )}
          {!hasOutput && (
            <p className="text-sm text-slate-500">
              此任務尚未試算，按上方「試算」開始。
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

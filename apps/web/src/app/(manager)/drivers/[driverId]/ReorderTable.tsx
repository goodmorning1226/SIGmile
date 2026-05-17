"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown, MapPin, Clock, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status/StatusBadge";
import { cn } from "@/lib/utils/cn";

interface StopItem {
  id: string;
  stop_order: number;
  status: string;
  planned_arrival_at: string | null;
  actual_arrival_at: string | null;
  completed_at: string | null;
  on_time: boolean | null;
  exception_reason: string | null;
  stop_name: string;
  stop_address: string;
}

interface Props {
  taskId: string;
  driverId: string;
  stops: StopItem[];
}

const TERMINAL = new Set(["completed", "failed", "skipped"]);

export function ReorderTable({ taskId, driverId, stops: initialStops }: Props) {
  const router = useRouter();
  const [stops, setStops] = useState(initialStops);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isReorderable = (s: StopItem) => !TERMINAL.has(s.status);

  const swap = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= stops.length) return;
    if (!isReorderable(stops[idx]) || !isReorderable(stops[target])) return;

    const next = [...stops];
    [next[idx].stop_order, next[target].stop_order] = [next[target].stop_order, next[idx].stop_order];
    next.sort((a, b) => a.stop_order - b.stop_order);
    setStops(next);
  };

  const hasChanges = JSON.stringify(stops.map((s) => [s.id, s.stop_order])) !==
                     JSON.stringify(initialStops.map((s) => [s.id, s.stop_order]));

  const save = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/manager/drivers/${driverId}/reorder`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task_id: taskId,
            items: stops.map((s) => ({ id: s.id, stop_order: s.stop_order }))
          })
        });
        const j = await res.json();
        if (!j.ok) throw new Error(j.error?.message ?? "重排失敗");
        setSavedAt(new Date().toLocaleTimeString("zh-TW"));
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "未知錯誤");
      }
    });
  };

  return (
    <div>
      {/* toolbar */}
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-3 bg-slate-50/50">
        <div className="text-xs text-slate-500">
          已完成 / 失敗的站不可調序
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-red-600">{error}</span>}
          {savedAt && !hasChanges && (
            <span className="inline-flex items-center gap-1 text-xs text-accent-700">
              <Check className="size-3" /> 已儲存 {savedAt}
            </span>
          )}
          <Button
            size="sm"
            variant={hasChanges ? "primary" : "outline"}
            disabled={!hasChanges}
            loading={pending}
            onClick={save}
          >
            儲存順序
          </Button>
        </div>
      </div>

      <ol className="divide-y divide-slate-100">
        {stops.map((s, idx) => (
          <li
            key={s.id}
            className={cn(
              "flex items-start gap-4 px-6 py-4",
              s.status === "completed" && "bg-accent-50/30",
              s.status === "failed" && "bg-red-50/30",
              s.status === "navigating" || s.status === "arrived" ? "bg-brand-50/30" : ""
            )}
          >
            {/* order */}
            <div className="grid size-9 shrink-0 place-items-center rounded-full border border-slate-200 bg-white font-semibold text-slate-700 tabular-nums">
              {s.stop_order}
            </div>

            {/* main */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="truncate font-semibold text-slate-900">{s.stop_name}</div>
                <StatusBadge status={s.status as any} />
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                <MapPin className="size-3" /> {s.stop_address}
              </div>
              <div className="mt-2 flex flex-wrap gap-4 text-xs">
                <MetaCell icon={<Clock className="size-3" />} label="預定" value={fmtTs(s.planned_arrival_at)} />
                <MetaCell label="實際抵達" value={fmtTs(s.actual_arrival_at)} />
                <MetaCell label="完成" value={fmtTs(s.completed_at)} />
                <MetaCell
                  label="準時"
                  value={s.on_time === null ? "—" : s.on_time ? "✓" : "✗"}
                  tone={s.on_time === false ? "bad" : s.on_time ? "good" : "default"}
                />
              </div>
              {s.exception_reason && (
                <div className="mt-2 inline-block rounded bg-red-50 px-2 py-0.5 text-xs text-red-700">
                  異常：{s.exception_reason}
                </div>
              )}
            </div>

            {/* reorder buttons */}
            <div className="flex flex-col gap-1">
              <button
                aria-label="上移"
                onClick={() => swap(idx, -1)}
                disabled={
                  idx === 0 ||
                  !isReorderable(s) ||
                  !isReorderable(stops[idx - 1])
                }
                className="grid size-7 place-items-center rounded border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronUp className="size-4" />
              </button>
              <button
                aria-label="下移"
                onClick={() => swap(idx, 1)}
                disabled={
                  idx === stops.length - 1 ||
                  !isReorderable(s) ||
                  !isReorderable(stops[idx + 1])
                }
                className="grid size-7 place-items-center rounded border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronDown className="size-4" />
              </button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function MetaCell({
  icon, label, value, tone = "default"
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  tone?: "default" | "good" | "bad";
}) {
  return (
    <div className="flex items-center gap-1.5">
      {icon && <span className="text-slate-400">{icon}</span>}
      <span className="text-slate-400">{label}</span>
      <span className={cn(
        "font-medium tabular-nums",
        tone === "good" ? "text-accent-700" :
        tone === "bad" ? "text-red-600" : "text-slate-700"
      )}>
        {value}
      </span>
    </div>
  );
}

function fmtTs(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
}

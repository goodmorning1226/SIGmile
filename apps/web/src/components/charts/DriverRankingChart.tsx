import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { DriverRanking } from "@/lib/services/dashboard-service";

/**
 * 物流士進度排行（horizontal bars）
 * 依完成率由高到低排序，落後的會被視覺凸顯。
 */
export function DriverRankingChart({
  data,
  limit = 8
}: {
  data: DriverRanking[];
  limit?: number;
}) {
  const visible = data.slice(0, limit);

  if (visible.length === 0) {
    return (
      <div className="grid place-items-center py-10 text-sm text-slate-500">
        今日尚無物流士派送
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {visible.map((d) => {
        const pct = d.total === 0 ? 0 : (d.completed / d.total) * 100;
        const isInProgress = d.task_status === "in_progress";
        const isDone = d.task_status === "completed";
        return (
          <li key={d.driver_id}>
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                <div
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
                    isDone
                      ? "bg-accent-100 text-accent-700"
                      : isInProgress
                      ? "bg-brand-100 text-brand-700"
                      : "bg-slate-100 text-slate-600"
                  )}
                >
                  {d.driver_name.slice(0, 1)}
                </div>
                <span className="truncate font-medium text-slate-800">
                  {d.driver_name}
                </span>
                {d.employee_code && (
                  <span className="text-slate-400">{d.employee_code}</span>
                )}
                {d.exceptions > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-red-600">
                    <AlertCircle className="size-3" /> {d.exceptions}
                  </span>
                )}
              </div>
              <span className="shrink-0 tabular-nums font-medium text-slate-700">
                {d.completed} / {d.total}
                <span className="ml-1 text-slate-400">
                  ({pct.toFixed(0)}%)
                </span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  isDone
                    ? "bg-accent-500"
                    : pct >= 50
                    ? "bg-brand-500"
                    : pct >= 25
                    ? "bg-amber-400"
                    : "bg-slate-300"
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}

      {data.length > limit && (
        <li className="pt-1 text-center text-xs text-slate-400">
          另有 {data.length - limit} 位物流士，請至「物流士」頁查看
        </li>
      )}
    </ul>
  );
}

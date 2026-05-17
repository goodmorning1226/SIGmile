"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, AlertCircle, Search, Truck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/status/StatusBadge";
import { SelectInput } from "@/components/form/SelectInput";
import { cn } from "@/lib/utils/cn";
import type { DriverOverviewRow } from "@/lib/services/driver-overview-service";

const STATUS_FILTERS = [
  { value: "all",         label: "全部狀態" },
  { value: "pending",     label: "尚未開始" },
  { value: "in_progress", label: "配送中" },
  { value: "completed",   label: "已完成" }
];

export function DriverGrid({ rows }: { rows: DriverOverviewRow[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = useMemo(() => {
    return rows
      .filter((r) =>
        statusFilter === "all" ? true : r.task_status === statusFilter
      )
      .filter((r) => {
        const q = search.trim().toLowerCase();
        if (!q) return true;
        const hay = [
          r.driver_name, r.employee_code ?? "", r.route_name ?? "",
          r.current_stop_name ?? "", r.next_stop_name ?? ""
        ].join(" ").toLowerCase();
        return hay.includes(q);
      });
  }, [rows, search, statusFilter]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_200px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="搜尋姓名、員工編號、路線、門市…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <SelectInput
          value={statusFilter}
          onChange={setStatusFilter}
          options={STATUS_FILTERS}
        />
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          顯示 <span className="font-semibold text-slate-700">{filtered.length}</span> / {rows.length} 位
        </span>
      </div>

      {/* Cards grid（可垂直滾動，支援大量物流士） */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Truck className="mx-auto size-10 text-slate-300" />
            <p className="mt-3 text-sm text-slate-500">
              {rows.length === 0 ? "今日尚無派送任務" : "沒有符合條件的物流士"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r) => <DriverTile key={r.task_id} row={r} />)}
        </div>
      )}
    </div>
  );
}

function DriverTile({ row: r }: { row: DriverOverviewRow }) {
  const pct = r.total === 0 ? 0 : Math.round((r.completed / r.total) * 100);
  const isInProgress = r.task_status === "in_progress";

  return (
    <Link href={`/drivers/${r.driver_id}`} className="group">
      <Card className="h-full transition hover:border-brand-300 hover:shadow-md">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className={cn(
                "grid size-10 shrink-0 place-items-center rounded-full font-semibold",
                isInProgress
                  ? "bg-brand-100 text-brand-700"
                  : r.task_status === "completed"
                  ? "bg-accent-100 text-accent-700"
                  : "bg-slate-100 text-slate-600"
              )}>
                {r.driver_name.slice(0, 1)}
              </div>
              <div className="min-w-0">
                <div className="truncate font-semibold text-slate-900">{r.driver_name}</div>
                <div className="truncate text-xs text-slate-500">
                  {r.employee_code ?? "—"} · {r.route_name ?? "未指派路線"}
                </div>
              </div>
            </div>
            <StatusBadge status={r.task_status as any} />
          </div>

          <div className="mt-3">
            <div className="flex items-baseline justify-between text-xs text-slate-500">
              <span>進度</span>
              <span className="font-medium text-slate-700">
                <span className="text-base font-semibold tabular-nums text-slate-900">{r.completed}</span>
                {" "}/ {r.total} · {pct}%
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-brand-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">目前</div>
              <div className="truncate font-medium text-slate-800">
                {r.current_stop_name ?? "—"}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">下一站</div>
              <div className="truncate text-slate-600">
                {r.next_stop_name ?? "—"}
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
            <div className="flex items-center gap-1 text-xs">
              {r.exceptions > 0 ? (
                <>
                  <AlertCircle className="size-3.5 text-red-500" />
                  <span className="font-medium text-red-600">{r.exceptions} 異常</span>
                </>
              ) : (
                <span className="text-slate-400">無異常</span>
              )}
            </div>
            <div className="flex items-center gap-0.5 text-xs font-medium text-brand-600 transition-all group-hover:gap-1.5">
              查看 <ChevronRight className="size-3.5" />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

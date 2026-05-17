"use client";

import { useMemo, useState } from "react";
import { Search, ChevronDown, ChevronUp, Truck, Calendar } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status/StatusBadge";
import { SelectInput } from "@/components/form/SelectInput";

interface Period {
  id: string;
  code: string;
  name: string;
  status: string;
  start_date: string;
  end_date: string;
}
interface Plan {
  id: string;
  planning_period_id: string;
  version: number;
  status: string;
  source: string;
  published_at: string | null;
  notes: string | null;
  created_at: string;
}
interface Assignment {
  id: string;
  route_plan_id: string;
  route_name: string;
  sequence: number;
  estimated_total_minutes: number | null;
  estimated_total_distance_meters: number | null;
  driver_name: string;
  driver_code: string | null;
  stops: { stop_order: number; name: string }[];
}

const SOURCE_LABEL: Record<string, string> = {
  manual: "手動建立",
  or_mock: "系統規劃",
  or_engine: "系統規劃",
  ai_suggested: "AI 建議"
};

const STATUS_FILTERS = [
  { value: "all", label: "全部狀態" },
  { value: "published", label: "已發布" },
  { value: "draft", label: "草稿" },
  { value: "archived", label: "已封存" }
];

export function HistoryBrowser({
  periods, plans, assignments
}: {
  periods: Period[];
  plans: Plan[];
  assignments: Assignment[];
}) {
  const [periodId, setPeriodId] = useState<string>(() =>
    periods.find((p) => p.status === "active")?.id ?? periods[0]?.id ?? ""
  );
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);

  // 篩選 plans
  const visiblePlans = useMemo(() => {
    return plans
      .filter((p) => !periodId || p.planning_period_id === periodId)
      .filter((p) => statusFilter === "all" || p.status === statusFilter)
      .filter((p) => {
        if (!search.trim()) return true;
        // 搜尋：版本號 / 來源 / 備註 / 該版本下的物流士姓名
        const q = search.toLowerCase();
        const planAssignees = assignments
          .filter((a) => a.route_plan_id === p.id)
          .flatMap((a) => [a.driver_name, a.driver_code ?? "", a.route_name]);
        return (
          String(p.version).includes(q) ||
          (p.notes ?? "").toLowerCase().includes(q) ||
          (SOURCE_LABEL[p.source] ?? "").toLowerCase().includes(q) ||
          planAssignees.some((s) => s.toLowerCase().includes(q))
        );
      });
  }, [plans, assignments, periodId, statusFilter, search]);

  const periodOptions = periods.map((p) => ({
    value: p.id,
    label: `${p.code} · ${p.name}${p.status === "active" ? "（啟用中）" : ""}`
  }));

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px_180px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="搜尋版本、物流士、備註…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <SelectInput
          value={periodId}
          onChange={setPeriodId}
          options={periodOptions}
        />
        <SelectInput
          value={statusFilter}
          onChange={setStatusFilter}
          options={STATUS_FILTERS}
        />
      </div>

      {/* Plans */}
      {visiblePlans.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">
          沒有符合條件的版本
        </div>
      ) : (
        <ul className="space-y-2">
          {visiblePlans.map((p) => {
            const period = periods.find((x) => x.id === p.planning_period_id);
            const isExpanded = expandedPlan === p.id;
            const planAssignments = assignments
              .filter((a) => a.route_plan_id === p.id)
              .sort((a, b) => a.sequence - b.sequence);
            return (
              <li
                key={p.id}
                className="rounded-lg border border-slate-200 bg-white"
              >
                <button
                  onClick={() => setExpandedPlan(isExpanded ? null : p.id)}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-slate-50"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">
                      第 {p.version} 版
                    </span>
                    <StatusBadge status={p.status as any} />
                    <Badge tone="neutral">
                      {SOURCE_LABEL[p.source] ?? p.source}
                    </Badge>
                    <span className="text-xs text-slate-500">
                      <Calendar className="mr-1 inline size-3" />
                      {period?.code ?? "—"}
                    </span>
                    {p.notes && (
                      <span className="hidden text-xs text-slate-500 sm:inline">
                        · {p.notes}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">
                      {planAssignments.length} 位物流士
                    </span>
                    <span className="text-xs text-slate-400">
                      {new Date(p.created_at).toLocaleDateString("zh-TW")}
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="size-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="size-4 text-slate-400" />
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="space-y-2 border-t border-slate-100 bg-slate-50/40 px-4 py-3">
                    {planAssignments.length === 0 ? (
                      <p className="text-sm text-slate-500">此版本尚未指派物流士</p>
                    ) : (
                      planAssignments.map((a) => (
                        <div
                          key={a.id}
                          className="rounded-md border border-slate-200 bg-white p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Truck className="size-4 text-brand-500" />
                              <span className="font-medium text-slate-900">
                                {a.driver_name}
                              </span>
                              <span className="text-xs text-slate-500">
                                {a.driver_code ?? "—"} · {a.route_name}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500">
                              {a.estimated_total_minutes ?? "—"} 分鐘 ·{" "}
                              {a.estimated_total_distance_meters
                                ? `${(a.estimated_total_distance_meters / 1000).toFixed(1)} km`
                                : "—"}
                            </div>
                          </div>
                          {a.stops.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {a.stops.map((s) => (
                                <span
                                  key={s.stop_order}
                                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs"
                                >
                                  <span className="grid size-4 place-items-center rounded-full bg-brand-500 text-[10px] font-semibold text-white">
                                    {s.stop_order}
                                  </span>
                                  {s.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

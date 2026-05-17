import { History } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { HistoryBrowser } from "./HistoryBrowser";

export const dynamic = "force-dynamic";

interface PeriodRow {
  id: string; code: string; name: string;
  start_date: string; end_date: string; status: string;
}
interface PlanRow {
  id: string;
  planning_period_id: string;
  version: number;
  status: string;
  source: string;
  published_at: string | null;
  notes: string | null;
  created_at: string;
}
interface AssignmentRow {
  id: string;
  route_plan_id: string;
  route_name: string;
  sequence: number;
  estimated_total_minutes: number | null;
  estimated_total_distance_meters: number | null;
  driver: { full_name: string; employee_code: string | null } | { full_name: string; employee_code: string | null }[] | null;
  route_stops: Array<{ id: string; stop_order: number; stop: { name: string } | { name: string }[] | null }>;
}

export default async function RouteHistoryPage() {
  const supabase = await createSupabaseServerClient();

  const { data: periods } = await supabase
    .from("planning_periods")
    .select("id, code, name, start_date, end_date, status")
    .order("start_date", { ascending: false })
    .returns<PeriodRow[]>();

  const { data: plans } = await supabase
    .from("route_plans")
    .select(
      "id, planning_period_id, version, status, source, published_at, notes, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<PlanRow[]>();

  const { data: assignments } = await supabase
    .from("driver_route_assignments")
    .select(
      "id, route_plan_id, route_name, sequence, " +
        "estimated_total_minutes, estimated_total_distance_meters, " +
        "driver:profiles(full_name, employee_code), " +
        "route_stops(id, stop_order, stop:stops(name))"
    )
    .returns<AssignmentRow[]>();

  return (
    <>
      <PageHeader
        title="路線歷史"
        description="檢視所有規劃期間下，過去發布過、或仍在草稿的路線版本"
      />

      {(periods ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">
            尚未建立任何規劃期間
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <History className="size-4 text-brand-500" />
              <CardTitle>路線版本列表</CardTitle>
            </div>
            <CardDescription>可依期間 / 狀態 / 物流士姓名搜尋</CardDescription>
          </CardHeader>
          <CardContent>
            <HistoryBrowser
              periods={(periods ?? []).map((p) => ({
                id: p.id,
                code: p.code,
                name: p.name,
                status: p.status,
                start_date: p.start_date,
                end_date: p.end_date
              }))}
              plans={(plans ?? [])}
              assignments={(assignments ?? []).map((a) => {
                const driver = Array.isArray(a.driver) ? a.driver[0] : a.driver;
                const stops = (a.route_stops ?? [])
                  .slice()
                  .sort((x, y) => x.stop_order - y.stop_order)
                  .map((rs) => ({
                    stop_order: rs.stop_order,
                    name:
                      (Array.isArray(rs.stop) ? rs.stop[0] : rs.stop)?.name ?? "?"
                  }));
                return {
                  id: a.id,
                  route_plan_id: a.route_plan_id,
                  route_name: a.route_name,
                  sequence: a.sequence,
                  estimated_total_minutes: a.estimated_total_minutes,
                  estimated_total_distance_meters: a.estimated_total_distance_meters,
                  driver_name: driver?.full_name ?? "(未指派)",
                  driver_code: driver?.employee_code ?? null,
                  stops
                };
              })}
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}

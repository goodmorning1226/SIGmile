import { Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getActivePeriod,
  listEditablePlans,
  getPlanForEdit
} from "@/lib/services/cluster-service";
import {
  PlanTabsSelector,
  PublishedReadOnlyBanner,
  DraftPublishBanner,
  type PlanTabKey
} from "@/components/route-planning/PlanTabsSelector";
import { AssignmentBoard, type DriverOption } from "./AssignmentBoard";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ plan?: string; tab?: string }>;
}

export default async function AssignmentPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const period = await getActivePeriod();

  if (!period) {
    return (
      <>
        <PageHeader title="物流士分配" description="把 OR 跑出的路線集指派給物流士" />
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">
            尚未建立任何規劃期間
          </CardContent>
        </Card>
      </>
    );
  }

  // ★ plans + drivers 同步抓
  const admin = createSupabaseAdminClient();
  const [plans, driversRes] = await Promise.all([
    listEditablePlans(period.id),
    admin
      .from("profiles")
      .select("id, full_name, employee_code, shift, vehicle_capacity, temperature_capability, is_active")
      .eq("role", "driver")
      .eq("is_active", true)
      .order("employee_code", { ascending: true })
  ]);
  const driversRaw = driversRes.data;

  const activeTab: PlanTabKey = sp.tab === "published" ? "published" : "drafts";

  const tabPlans = plans.filter((p) =>
    activeTab === "drafts" ? p.status === "draft" : p.status === "published"
  );

  const planId =
    (sp.plan && tabPlans.find((p) => p.id === sp.plan)?.id) ||
    tabPlans[0]?.id || null;

  const plan = planId ? await getPlanForEdit(planId) : null;
  const isPublishedView = plan?.status === "published";

  const drivers: DriverOption[] = ((driversRaw ?? []) as Array<{
    id: string; full_name: string; employee_code: string | null;
    shift: string | null; vehicle_capacity: number | null;
    temperature_capability: string | null;
  }>).map((d) => ({
    id: d.id,
    full_name: d.full_name,
    employee_code: d.employee_code,
    shift: d.shift,
    vehicle_capacity: d.vehicle_capacity,
    temperature_capability: d.temperature_capability
  }));

  return (
    <>
      <PageHeader
        title="物流士分配"
        description="把 OR 跑出的路線集指派給物流士。OR 跑完時已預先建議分配，可在此檢視或微調。"
      />

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="size-4 text-brand-500" />
            <CardTitle>選擇版本</CardTitle>
          </div>
          <CardDescription>
            目前期間：<strong>{period.code} · {period.name}</strong>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PlanTabsSelector
            basePath="/assignment"
            plans={plans}
            activeTab={activeTab}
            activePlanId={planId}
          />
        </CardContent>
      </Card>

      {plan && (
        <div className="space-y-4">
          {isPublishedView ? (
            <PublishedReadOnlyBanner />
          ) : (
            <DraftPublishBanner planId={plan.id} version={plan.version} />
          )}
          <AssignmentBoard plan={plan} drivers={drivers} readOnly={isPublishedView} />
        </div>
      )}
    </>
  );
}

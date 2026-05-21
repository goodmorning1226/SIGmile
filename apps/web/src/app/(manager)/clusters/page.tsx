import { Layers } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { ClusterEditor } from "./ClusterEditor";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ plan?: string; tab?: string }>;
}

export default async function ClustersPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const period = await getActivePeriod();

  if (!period) {
    return (
      <>
        <PageHeader
          title="路線集"
          description="OR 跑完後的路線集合，每個路線集包含停靠點順序與指派的物流士"
        />
        <Card>
          <CardContent className="py-12 text-center text-sm text-slate-500">
            尚未建立任何規劃期間
          </CardContent>
        </Card>
      </>
    );
  }

  const plans = await listEditablePlans(period.id);
  const activeTab: PlanTabKey = sp.tab === "published" ? "published" : "drafts";

  const tabPlans = plans.filter((p) =>
    activeTab === "drafts" ? p.status === "draft" : p.status === "published"
  );

  // 優先順序：URL 指定 → 此 tab 第一筆 → null
  const planId =
    (sp.plan && tabPlans.find((p) => p.id === sp.plan)?.id) ||
    tabPlans[0]?.id || null;

  const plan = planId ? await getPlanForEdit(planId) : null;
  const isPublishedView = plan?.status === "published";

  return (
    <>
      <PageHeader
        title="路線集"
        description="OR 跑完後產生的路線集合。每個路線集對應一條物流士當天要跑的路線（含停靠順序）。"
      />

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Layers className="size-4 text-brand-500" />
            <CardTitle>選擇版本</CardTitle>
          </div>
          <CardDescription>
            目前期間：<strong>{period.code} · {period.name}</strong>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PlanTabsSelector
            basePath="/clusters"
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
          <ClusterEditor plan={plan} readOnly={isPublishedView} />
        </div>
      )}
    </>
  );
}

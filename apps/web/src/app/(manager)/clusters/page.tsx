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
        <PageHeader title="停靠點分群" description="把停靠點分成幾個群組，方便後續指派物流士" />
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
        title="停靠點分群"
        description="把停靠點分成幾個群組並排序。每個群組之後會被指派給一位物流士。"
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
          {isPublishedView && <PublishedReadOnlyBanner />}
          <ClusterEditor plan={plan} readOnly={isPublishedView} />
        </div>
      )}
    </>
  );
}

import { CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  getQuarterlyAnalysis, defaultQuarter
} from "@/lib/services/quarterly-analysis-service";
import { QuarterlySection } from "../dashboard/QuarterlySection";
import { QuarterSelector } from "./QuarterSelector";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function QuarterlyAnalysisPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const quarter = sp.q && /^\d{4}Q[1-4]$/.test(sp.q) ? sp.q : defaultQuarter();
  const data = await getQuarterlyAnalysis(quarter);

  return (
    <>
      <PageHeader
        title="季度分析"
        description="跨季 KPI 比較、月度趨勢、門市異常熱點、站點狀態分佈"
        actions={
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-slate-400" />
            <QuarterSelector current={quarter} basePath="/quarterly-analysis" />
          </div>
        }
      />

      <QuarterlySection data={data} quarter={quarter} />
    </>
  );
}

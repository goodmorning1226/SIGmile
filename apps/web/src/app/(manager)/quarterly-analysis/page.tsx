import { CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  getQuarterlyAnalysis, defaultQuarter
} from "@/lib/services/quarterly-analysis-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { QuarterlySection } from "../dashboard/QuarterlySection";
import { QuarterSelector } from "./QuarterSelector";
import { AiParameterDisplay, type AiParamRow } from "./AiParameterDisplay";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function QuarterlyAnalysisPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const quarter = sp.q && /^\d{4}Q[1-4]$/.test(sp.q) ? sp.q : defaultQuarter();

  // 同時撈：季度統計 + 下季 AI 預測參數（σ / q）
  const admin = createSupabaseAdminClient();
  const [data, paramsRes] = await Promise.all([
    getQuarterlyAnalysis(quarter),
    admin
      .from("ai_parameter_predictions")
      .select("id, prediction_type, output_parameters, confidence_score, model_version, created_at")
      .in("prediction_type", ["service_minutes", "stop_demand"])
      .order("created_at", { ascending: false })
      .limit(2)
  ]);

  // 兩種 prediction_type 各取最新一筆
  const latestByType = new Map<string, AiParamRow>();
  for (const p of (paramsRes.data ?? []) as AiParamRow[]) {
    if (!latestByType.has(p.prediction_type)) {
      latestByType.set(p.prediction_type, p);
    }
  }
  const aiParams = Array.from(latestByType.values());

  return (
    <>
      <PageHeader
        title="季度分析"
        description="跨季 KPI 比較、月度趨勢、門市異常熱點、下季 AI 預測參數"
        actions={
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-slate-400" />
            <QuarterSelector current={quarter} basePath="/quarterly-analysis" />
          </div>
        }
      />

      <div className="space-y-6">
        <QuarterlySection data={data} quarter={quarter} />
        <AiParameterDisplay rows={aiParams} />
      </div>
    </>
  );
}

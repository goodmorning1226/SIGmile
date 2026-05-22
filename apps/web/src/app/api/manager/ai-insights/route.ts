import { requireManager } from "@/lib/auth/server-auth";
import { ok, handleApiError } from "@/lib/api/response";
import { buildInsight } from "@/lib/services/ai-insights-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/manager/ai-insights
 *   body: { date?, comparison_days? }
 *   1. 用 ai-insights-service 算出完整 insight
 *   2. 順手寫進 ai_analysis_requests（沿用既有歷史頁面）
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireManager();
    const body = await request.json().catch(() => ({}));

    const insight = await buildInsight({
      date: body?.date,
      comparison_days: body?.comparison_days
    });

    const admin = createSupabaseAdminClient();
    // 寫進 ai_analysis_requests，這樣歷史頁也能看到深度分析
    await admin.from("ai_analysis_requests").insert({
      requested_by: ctx.userId,
      scope: "today_overview",
      status: "completed",
      model_version: "insights-v1",
      input_snapshot: { kpi: insight.kpi },
      output_analysis: {
        summary: insight.headline,
        risk_level: insight.risk_level,
        delayed_routes: insight.delayed_routes.map((d) => ({
          driver_name: d.driver_name,
          route_name: d.route_name,
          delayed_stops: d.delayed_stops,
          estimated_delay_minutes: d.estimated_delay_minutes
        })),
        recommended_actions: insight.actions.map((a) => a.text),
        generated_at: insight.generated_at,
        // 額外的 insight 整包保留，未來歷史頁可顯示
        deep_insight: insight
      },
      completed_at: new Date().toISOString()
    });

    return ok({ insight });
  } catch (e) {
    return handleApiError(e);
  }
}

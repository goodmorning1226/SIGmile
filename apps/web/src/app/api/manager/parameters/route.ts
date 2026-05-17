import { requireManager } from "@/lib/auth/server-auth";
import { ok, fail, handleApiError } from "@/lib/api/response";
import { aiService } from "@/lib/services/ai-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/manager/parameters
 * body: { planning_period_id, prediction_type }
 * 呼叫 MockAIService.predictPlanningParameters，並寫一筆 ai_parameter_predictions。
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireManager();
    const body = (await request.json().catch(() => ({}))) as {
      planning_period_id?: string;
      prediction_type?: string;
    };
    if (!body.planning_period_id || !body.prediction_type) {
      return fail("BAD_REQUEST", "planning_period_id 與 prediction_type 為必填", 400);
    }

    const ALLOWED = ["service_minutes", "stop_demand", "eta", "workload", "risk"] as const;
    if (!ALLOWED.includes(body.prediction_type as (typeof ALLOWED)[number])) {
      return fail("BAD_REQUEST", `prediction_type 必須為 ${ALLOWED.join("/")}`, 400);
    }

    const result = await aiService.predictPlanningParameters({
      planning_period_id: body.planning_period_id,
      prediction_type: body.prediction_type as (typeof ALLOWED)[number]
    });

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("ai_parameter_predictions")
      .insert({
        planning_period_id: body.planning_period_id,
        prediction_type: body.prediction_type,
        output_parameters: result.output_parameters,
        confidence_score: result.confidence_score,
        model_version: result.model_version,
        generated_by: ctx.userId
      })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("insert failed");

    return ok({ id: data.id, result });
  } catch (e) {
    return handleApiError(e);
  }
}

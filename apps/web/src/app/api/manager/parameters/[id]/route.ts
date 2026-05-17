import { requireManager } from "@/lib/auth/server-auth";
import { ok, fail, handleApiError } from "@/lib/api/response";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/manager/parameters/[id]
 * body: { output_parameters?: object, confidence_score?: number }
 *
 * 主管手動微調某筆預測。修完之後下次 OR job 拿來當 input_parameters 就會用到新值。
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireManager();
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      output_parameters?: Record<string, unknown>;
      confidence_score?: number;
    };
    if (!body.output_parameters && body.confidence_score === undefined) {
      return fail("BAD_REQUEST", "請至少提供 output_parameters 或 confidence_score", 400);
    }

    const admin = createSupabaseAdminClient();
    const patch: Record<string, unknown> = {};
    if (body.output_parameters) patch.output_parameters = body.output_parameters;
    if (body.confidence_score !== undefined) patch.confidence_score = body.confidence_score;

    const { data, error } = await admin
      .from("ai_parameter_predictions")
      .update(patch)
      .eq("id", id)
      .select("id, prediction_type, output_parameters, confidence_score")
      .single();
    if (error || !data) throw error ?? new Error("update failed");
    return ok({ prediction: data });
  } catch (e) {
    return handleApiError(e);
  }
}

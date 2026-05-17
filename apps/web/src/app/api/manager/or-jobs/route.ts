import { requireManager } from "@/lib/auth/server-auth";
import { ok, fail, handleApiError } from "@/lib/api/response";
import { orPlanningService } from "@/lib/services/or-planning-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface OrJobListRow {
  id: string;
  planning_period_id: string;
  status: string;
  engine_version: string | null;
  input_parameters: Record<string, unknown>;
  output_plan: Record<string, unknown>;
  created_route_plan_id: string | null;
  created_at: string;
  completed_at: string | null;
}

/** GET /api/manager/or-jobs — 列出所有 OR job（最新優先） */
export async function GET() {
  try {
    await requireManager();
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("or_planning_jobs")
      .select("id, planning_period_id, status, engine_version, input_parameters, " +
              "output_plan, created_route_plan_id, created_at, completed_at")
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<OrJobListRow[]>();
    if (error) throw error;
    return ok({ jobs: data ?? [] });
  } catch (e) {
    return handleApiError(e);
  }
}

/** POST /api/manager/or-jobs — 建立新 job（status=pending） */
export async function POST(request: Request) {
  try {
    const ctx = await requireManager();
    const body = (await request.json().catch(() => ({}))) as {
      planning_period_id?: string;
      input_parameters?: Record<string, unknown>;
    };
    if (!body.planning_period_id) {
      return fail("BAD_REQUEST", "planning_period_id 為必填", 400);
    }
    const { jobId } = await orPlanningService.createPlanningJob({
      planning_period_id: body.planning_period_id,
      requested_by: ctx.userId,
      input_parameters: body.input_parameters ?? {}
    });
    return ok({ jobId });
  } catch (e) {
    return handleApiError(e);
  }
}

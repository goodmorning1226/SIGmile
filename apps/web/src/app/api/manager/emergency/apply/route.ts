import { requireManager } from "@/lib/auth/server-auth";
import { ok, fail, handleApiError } from "@/lib/api/response";
import { applyReroute, type ReroutePlan } from "@/lib/services/emergency-reroute-service";

export const dynamic = "force-dynamic";

/** POST /api/manager/emergency/apply — 把 plan 寫進 DB */
export async function POST(request: Request) {
  try {
    await requireManager();
    const body = await request.json().catch(() => ({}));
    const plan = body?.plan as ReroutePlan | undefined;
    if (!plan || !plan.down_driver) return fail("BAD_REQUEST", "plan 必填", 400);
    const result = await applyReroute(plan);
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}

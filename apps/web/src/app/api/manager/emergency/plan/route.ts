import { requireManager } from "@/lib/auth/server-auth";
import { ok, fail, handleApiError } from "@/lib/api/response";
import { planReroute } from "@/lib/services/emergency-reroute-service";

export const dynamic = "force-dynamic";

/** POST /api/manager/emergency/plan — AI 算重派方案（不寫 DB） */
export async function POST(request: Request) {
  try {
    await requireManager();
    const body = await request.json().catch(() => ({}));
    if (!body?.down_driver_id) return fail("BAD_REQUEST", "down_driver_id 必填", 400);
    const result = await planReroute({
      down_driver_id: body.down_driver_id,
      date: body.date
    });
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}

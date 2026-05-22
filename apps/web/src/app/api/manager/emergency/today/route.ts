import { requireManager } from "@/lib/auth/server-auth";
import { ok, handleApiError } from "@/lib/api/response";
import { getTodaySnapshot } from "@/lib/services/emergency-reroute-service";

export const dynamic = "force-dynamic";

/** GET /api/manager/emergency/today — 今日所有 driver 進度（給「Mark Down」用） */
export async function GET() {
  try {
    await requireManager();
    const result = await getTodaySnapshot();
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}

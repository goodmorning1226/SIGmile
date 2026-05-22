import { requireManager } from "@/lib/auth/server-auth";
import { ok, fail, handleApiError } from "@/lib/api/response";
import { getDriverPendingStops } from "@/lib/services/emergency-reroute-service";

export const dynamic = "force-dynamic";

/** GET /api/manager/emergency/driver-stops?driver_id=...&date=... — 列出某 driver 今日 pending stops */
export async function GET(request: Request) {
  try {
    await requireManager();
    const url = new URL(request.url);
    const driverId = url.searchParams.get("driver_id");
    if (!driverId) return fail("BAD_REQUEST", "driver_id 必填", 400);
    const date = url.searchParams.get("date") ?? undefined;
    const data = await getDriverPendingStops({ driver_id: driverId, date });
    return ok(data);
  } catch (e) {
    return handleApiError(e);
  }
}

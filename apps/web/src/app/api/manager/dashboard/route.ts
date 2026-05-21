import { requireManager } from "@/lib/auth/server-auth";
import { ok, handleApiError } from "@/lib/api/response";
import { getDashboardBundle } from "@/lib/services/dashboard-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireManager();
    const url = new URL(request.url);
    const date = url.searchParams.get("date") ?? undefined;
    const { kpi } = await getDashboardBundle(date);
    return ok({ kpi });
  } catch (e) {
    return handleApiError(e);
  }
}

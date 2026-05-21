import { requireManager } from "@/lib/auth/server-auth";
import { ok, handleApiError } from "@/lib/api/response";
import { generateMockUrgentShipments } from "@/lib/services/urgent-dispatch-service";

export const dynamic = "force-dynamic";

/** POST /api/manager/urgent/mock — 產生 N 筆 mock 急件（in-memory） */
export async function POST(request: Request) {
  try {
    await requireManager();
    const body = await request.json().catch(() => ({}));
    const items = await generateMockUrgentShipments({
      count: Number(body?.count ?? 5),
      seed: body?.seed ? Number(body.seed) : undefined
    });
    return ok({ items });
  } catch (e) {
    return handleApiError(e);
  }
}

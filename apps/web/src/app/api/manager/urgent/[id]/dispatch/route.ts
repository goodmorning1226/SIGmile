import { requireManager } from "@/lib/auth/server-auth";
import { ok, handleApiError } from "@/lib/api/response";
import { suggestUrgentDispatch } from "@/lib/services/urgent-dispatch-service";

export const dynamic = "force-dynamic";

/** POST /api/manager/urgent/[id]/dispatch — AI 給候選 driver 排名（不寫 DB） */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireManager();
    const { id } = await context.params;
    const result = await suggestUrgentDispatch(id);
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}

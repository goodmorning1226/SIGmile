import { requireManager } from "@/lib/auth/server-auth";
import { ok, handleApiError } from "@/lib/api/response";
import { listUrgent, clearAllUrgent } from "@/lib/services/urgent-store";

export const dynamic = "force-dynamic";

/** GET /api/manager/urgent — 列出所有急件 */
export async function GET() {
  try {
    await requireManager();
    return ok({ items: listUrgent() });
  } catch (e) {
    return handleApiError(e);
  }
}

/** DELETE /api/manager/urgent — 清空所有急件（demo reset） */
export async function DELETE() {
  try {
    await requireManager();
    const n = clearAllUrgent();
    return ok({ cleared: n });
  } catch (e) {
    return handleApiError(e);
  }
}

import { requireManager } from "@/lib/auth/server-auth";
import { ok, handleApiError } from "@/lib/api/response";
import { listUrgent, clearAllUrgent } from "@/lib/services/urgent-store";
import { generateMockUrgentShipments } from "@/lib/services/urgent-dispatch-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/manager/urgent — 列出所有急件。
 * 第一次（store 為空）會自動產生 5 筆 mock 急件，
 * 主管打開頁面就有東西可以演示。重啟 server 後也會自動補。
 */
export async function GET() {
  try {
    await requireManager();
    let items = listUrgent();
    if (items.length === 0) {
      try {
        await generateMockUrgentShipments({ count: 5 });
        items = listUrgent();
      } catch (e) {
        // generate 失敗（例如沒 active stops），就回空陣列即可，別擋 UI
        console.warn("[urgent] auto-seed failed:", e);
      }
    }
    return ok({ items });
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

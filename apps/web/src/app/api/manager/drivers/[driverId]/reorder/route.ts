import { requireManager } from "@/lib/auth/server-auth";
import { ok, fail, handleApiError } from "@/lib/api/response";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/manager/drivers/[driverId]/reorder
 * body: { task_id: string, items: [{ id: string, stop_order: number }, ...] }
 *
 * 僅允許重排還沒結案的 task_stop（status in pending / navigating / arrived）。
 * 已完成 / 已失敗 / 已略過的 stop 不能改順序。
 *
 * 寫入分兩階段：先 push 到負值避開 unique (delivery_task_id, stop_order)
 * 衝突，再寫真實值。
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ driverId: string }> }
) {
  try {
    await requireManager();
    const { driverId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      task_id?: string;
      items?: Array<{ id: string; stop_order: number }>;
    };
    if (!body.task_id || !Array.isArray(body.items) || body.items.length === 0) {
      return fail("BAD_REQUEST", "task_id 與 items 為必填", 400);
    }

    const admin = createSupabaseAdminClient();

    // 驗證 task 屬於此 driver
    const { data: taskCheck, error: tErr } = await admin
      .from("delivery_tasks")
      .select("id, driver_id")
      .eq("id", body.task_id)
      .single();
    if (tErr || !taskCheck) return fail("NOT_FOUND", "task 不存在", 404);
    if (taskCheck.driver_id !== driverId) {
      return fail("FORBIDDEN", "task 不屬於此 driver", 403);
    }

    // 兩階段寫入避免 unique constraint 衝突
    for (const it of body.items) {
      await admin
        .from("delivery_task_stops")
        .update({ stop_order: -Math.abs(it.stop_order) - 1000 })
        .eq("id", it.id)
        .eq("delivery_task_id", body.task_id);
    }
    for (const it of body.items) {
      await admin
        .from("delivery_task_stops")
        .update({ stop_order: it.stop_order })
        .eq("id", it.id)
        .eq("delivery_task_id", body.task_id);
    }

    return ok({ reordered: body.items.length });
  } catch (e) {
    return handleApiError(e);
  }
}

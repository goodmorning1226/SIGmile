import { requireManager } from "@/lib/auth/server-auth";
import { ok, fail, handleApiError } from "@/lib/api/response";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/manager/clusters/by-plan?plan_id=<uuid>
 *
 * 只回 id + sequence。用途：路線分配頁存完 cluster 結構後，要重新拿到新生成的 cluster id
 * 才能跟著存 driver assignment。
 */
export async function GET(request: Request) {
  try {
    await requireManager();
    const url = new URL(request.url);
    const planId = url.searchParams.get("plan_id");
    if (!planId) return fail("BAD_REQUEST", "plan_id 必填", 400);

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("driver_clusters")
      .select("id, sequence")
      .eq("route_plan_id", planId)
      .order("sequence", { ascending: true })
      .returns<{ id: string; sequence: number }[]>();
    if (error) throw error;
    return ok({ clusters: data ?? [] });
  } catch (e) {
    return handleApiError(e);
  }
}

import { requireManager } from "@/lib/auth/server-auth";
import { ok, fail, handleApiError } from "@/lib/api/response";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/manager/assignment/save
 * body: {
 *   plan_id: string,
 *   assignments: Array<{
 *     cluster_id: string,
 *     driver_id: string | null    // null = 取消指派
 *   }>
 * }
 *
 * 流程：
 *   1. 把 driver_clusters.assigned_driver_id 更新
 *   2. driver_route_assignments：用 cluster 為 key 同步上下到 driver_id
 *      （若還沒對應的 driver_route_assignments，建一筆）
 *   3. 把該 cluster 底下的 route_stops.driver_route_assignment_id 指向那筆 dra
 *
 * 這樣「發布時就直接 publishPlan」即可，無需再做轉換。
 */
export async function POST(request: Request) {
  try {
    await requireManager();
    const body = await request.json().catch(() => ({}));
    const planId = body?.plan_id as string | undefined;
    const items  = body?.assignments as Array<{ cluster_id?: string; driver_id?: string | null }> | undefined;
    if (!planId || !Array.isArray(items)) {
      return fail("BAD_REQUEST", "plan_id 與 assignments 為必填", 400);
    }

    const admin = createSupabaseAdminClient();

    // 1. 把每個 cluster 的 assigned_driver_id 更新
    for (const it of items) {
      if (!it.cluster_id) continue;
      await admin
        .from("driver_clusters")
        .update({ assigned_driver_id: it.driver_id ?? null })
        .eq("id", it.cluster_id)
        .eq("route_plan_id", planId);
    }

    // 2. 同步 driver_route_assignments
    //    找 plan 下所有 clusters + 它們的 stops
    interface ClusterListRow {
      id: string;
      cluster_name: string;
      sequence: number;
      assigned_driver_id: string | null;
      estimated_total_minutes: number | null;
      estimated_total_distance_meters: number | null;
    }
    const { data: clusters } = await admin
      .from("driver_clusters")
      .select("id, cluster_name, sequence, assigned_driver_id, " +
              "estimated_total_minutes, estimated_total_distance_meters")
      .eq("route_plan_id", planId)
      .order("sequence", { ascending: true })
      .returns<ClusterListRow[]>();

    const clusterList: ClusterListRow[] = clusters ?? [];

    // 先把該 plan 下的 dra 全部解綁 cluster
    // （省事策略：用 cluster_id 覆寫；再清掉 cluster_id 為 null 的孤兒 dra）
    for (const c of clusterList) {
      // upsert by (route_plan_id, cluster_id)
      // 但 schema 沒這 unique key 所以手動：先查、再 upsert
      const { data: existing } = await admin
        .from("driver_route_assignments")
        .select("id")
        .eq("route_plan_id", planId)
        .eq("cluster_id", c.id)
        .maybeSingle();

      let draId: string;
      if (existing?.id) {
        draId = existing.id as string;
        await admin
          .from("driver_route_assignments")
          .update({
            driver_id: c.assigned_driver_id,
            route_name: c.cluster_name,
            sequence: c.sequence,
            estimated_total_minutes: c.estimated_total_minutes,
            estimated_total_distance_meters: c.estimated_total_distance_meters
          })
          .eq("id", draId);
      } else {
        const { data: newDra, error: insErr } = await admin
          .from("driver_route_assignments")
          .insert({
            route_plan_id: planId,
            cluster_id: c.id,
            driver_id: c.assigned_driver_id,
            route_name: c.cluster_name,
            sequence: c.sequence,
            estimated_total_minutes: c.estimated_total_minutes,
            estimated_total_distance_meters: c.estimated_total_distance_meters
          })
          .select("id")
          .single();
        if (insErr || !newDra) throw insErr ?? new Error("Failed to create assignment");
        draId = newDra.id as string;
      }

      // 把這個 cluster 底下所有 route_stops 的 driver_route_assignment_id 改成這支 dra
      await admin
        .from("route_stops")
        .update({ driver_route_assignment_id: draId })
        .eq("cluster_id", c.id);
    }

    return ok({ plan_id: planId, assignments_saved: items.length });
  } catch (e) {
    return handleApiError(e);
  }
}

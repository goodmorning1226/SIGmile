import { requireManager } from "@/lib/auth/server-auth";
import { ok, fail, handleApiError } from "@/lib/api/response";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/manager/clusters/save
 * body: {
 *   plan_id: string,
 *   clusters: Array<{
 *     id?: string,                   // null = 新建 cluster
 *     cluster_name: string,
 *     sequence: number,
 *     stops: Array<{ route_stop_id: string, stop_order: number, trip_index: number }>
 *   }>
 * }
 *
 * 設計：bulk save。前端把整個編輯後的狀態送上來，後端：
 *   1. 把 route_stops 全部從這個 plan 解綁 cluster_id
 *   2. 刪掉這個 plan 下原本的 clusters
 *   3. 重新依 body 建 cluster + 把 route_stops 重新綁 cluster_id 與更新 stop_order/trip_index
 *
 * 這個策略很單純（避免要 diff 三張表），但會破壞 cluster.id 的穩定性。
 * 若 cluster 已被 assigned 給 driver，會在後續 assign 頁面用 cluster_name 對應回去（建議盡量保留同名）。
 */
export async function POST(request: Request) {
  try {
    await requireManager();
    const body = await request.json().catch(() => ({}));
    const planId  = body?.plan_id as string | undefined;
    const groups  = body?.clusters as Array<{
      cluster_name?: string;
      sequence?: number;
      stops?: Array<{ route_stop_id?: string; stop_order?: number; trip_index?: number }>;
    }> | undefined;
    if (!planId || !Array.isArray(groups)) {
      return fail("BAD_REQUEST", "plan_id 與 clusters 為必填", 400);
    }

    const admin = createSupabaseAdminClient();

    // 取此 plan 下所有 route_stops 的 id（透過 driver_route_assignments 聯結）
    const { data: assignmentRows } = await admin
      .from("driver_route_assignments")
      .select("id")
      .eq("route_plan_id", planId);
    const assignmentIds = (assignmentRows ?? []).map((r) => r.id);

    if (assignmentIds.length === 0) {
      return fail("PLAN_HAS_NO_STOPS", "此版本尚無 route_stops 可分群", 400);
    }

    // 1. 解綁所有 route_stops 的 cluster_id
    await admin
      .from("route_stops")
      .update({ cluster_id: null })
      .in("driver_route_assignment_id", assignmentIds);

    // 2. 刪掉這個 plan 下原本的 clusters
    await admin.from("driver_clusters").delete().eq("route_plan_id", planId);

    // 3. 依 body 重新建 cluster
    let seq = 1;
    for (const g of groups) {
      const name = g.cluster_name?.trim();
      if (!name) continue;
      const stops = Array.isArray(g.stops) ? g.stops : [];

      const { data: newCluster, error: cErr } = await admin
        .from("driver_clusters")
        .insert({
          route_plan_id: planId,
          cluster_name: name,
          sequence: g.sequence ?? seq++
        })
        .select("id")
        .single();
      if (cErr || !newCluster) throw cErr ?? new Error("Failed to create cluster");

      // 兩階段更新 route_stops（避開 unique 衝突）
      //   第一階段：先把 stop_order 推到負值
      //   第二階段：寫入正式 stop_order + cluster_id + trip_index
      for (const s of stops) {
        if (!s.route_stop_id) continue;
        await admin
          .from("route_stops")
          .update({ stop_order: -Math.abs(s.stop_order ?? 1) - 100000 })
          .eq("id", s.route_stop_id);
      }
      let orderCounter = 1;
      for (const s of stops) {
        if (!s.route_stop_id) continue;
        await admin
          .from("route_stops")
          .update({
            cluster_id: newCluster.id,
            stop_order: s.stop_order ?? orderCounter,
            trip_index: s.trip_index ?? 1
          })
          .eq("id", s.route_stop_id);
        orderCounter++;
      }
    }

    return ok({ plan_id: planId, clusters_saved: groups.length });
  } catch (e) {
    return handleApiError(e);
  }
}

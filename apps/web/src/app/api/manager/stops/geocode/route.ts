import { requireManager } from "@/lib/auth/server-auth";
import { ok, fail, handleApiError } from "@/lib/api/response";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { geocodeBatch } from "@/lib/services/tomtom-geocoding-service";

export const dynamic = "force-dynamic";
// 一次最多 200 個 stops，每個 ~100ms，總共 ~20s
export const maxDuration = 120;

/**
 * POST /api/manager/stops/geocode
 *
 * 把所有「lat / lng 是 null」的 stops 用 TomTom Geocoding API 補上座標。
 * 可選 body: { mode: 'missing' | 'all' }  (預設 'missing')
 *
 * 回傳：
 *   {
 *     total_processed: N,
 *     updated: K,
 *     failed: M,
 *     errors: [{ external_code, error }, ...]
 *   }
 */
export async function POST(request: Request) {
  try {
    await requireManager();
    const body = await request.json().catch(() => ({})) as { mode?: "missing" | "all" };
    const mode = body.mode ?? "missing";

    if (!process.env.TOMTOM_API_KEY) {
      return fail("NO_TOMTOM_KEY", "TOMTOM_API_KEY 未設定，無法呼叫 geocoding。", 400);
    }

    const admin = createSupabaseAdminClient();
    interface StopRow {
      id: string;
      external_code: string | null;
      address: string;
      lat: number | null;
      lng: number | null;
    }
    let query = admin
      .from("stops")
      .select("id, external_code, address, lat, lng")
      .eq("is_active", true);
    if (mode === "missing") {
      query = query.or("lat.is.null,lng.is.null");
    }
    const { data, error } = await query.returns<StopRow[]>();
    if (error) throw error;

    const rows = data ?? [];
    if (rows.length === 0) {
      return ok({
        total_processed: 0,
        updated: 0,
        failed: 0,
        errors: [],
        message: mode === "missing"
          ? "所有 active stops 已有座標，無需 geocode。"
          : "沒有 active stops。"
      });
    }

    // 用 TomTom Geocoding API 批次轉換
    const results = await geocodeBatch(
      rows.map((r) => ({ id: r.id, address: r.address }))
    );

    // upsert 回 DB
    let updated = 0;
    const failures: Array<{ external_code: string | null; address: string; error: string }> = [];
    for (const r of results) {
      const row = rows.find((s) => s.id === r.id)!;
      if (r.ok && r.lat != null && r.lng != null) {
        const { error: upErr } = await admin
          .from("stops")
          .update({ lat: r.lat, lng: r.lng })
          .eq("id", r.id);
        if (upErr) {
          failures.push({ external_code: row.external_code, address: row.address, error: upErr.message });
        } else {
          updated++;
        }
      } else {
        failures.push({
          external_code: row.external_code,
          address: row.address,
          error: r.error ?? "unknown"
        });
      }
    }

    return ok({
      total_processed: rows.length,
      updated,
      failed: failures.length,
      errors: failures.slice(0, 20),
      mode
    });
  } catch (e) {
    return handleApiError(e);
  }
}

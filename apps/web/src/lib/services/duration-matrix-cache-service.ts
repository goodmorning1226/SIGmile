import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  computeDurationMatrix as computeFresh,
  type LatLng,
  type MatrixResult
} from "@/lib/services/tomtom-matrix-service";

/**
 * Duration matrix with DB-backed cache.
 *
 * 策略：
 *   1. 來 N 個點（depot + stops），每點有 id (UUID) 跟 lat/lng
 *   2. 查 travel_time_cache 抓現有的 pair → 填入 matrix
 *   3. 收集 missing pairs → 整批打 TomTom Matrix API（或 haversine fallback）→ 寫回 cache
 *   4. 回傳 N×N 矩陣
 *
 * 失效：
 *   - stops / distribution_centers 的 lat/lng 改了 → DB trigger 自動刪 cache row
 *   - 所以 caller 不用管失效，只要點正確就會自動 refresh
 */

export interface MatrixNode extends LatLng {
  /** stops.id 或 distribution_centers.id；用來當 cache key */
  id: string;
}

export interface CachedMatrixResult extends MatrixResult {
  /** 命中 cache 的 cell 數量 */
  cache_hits: number;
  /** 沒命中、這次從 TomTom 新算的 cell 數量 */
  fresh_fetched: number;
}

/**
 * 取得 N×N duration / distance 矩陣。優先讀 travel_time_cache，缺的才打 TomTom。
 * 結果都會 upsert 回 cache。
 */
export async function getOrComputeCachedMatrix(
  nodes: MatrixNode[]
): Promise<CachedMatrixResult> {
  const n = nodes.length;
  const durationMinutes: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const distanceMeters:  number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  if (n < 2) {
    return { durationMinutes, distanceMeters, isReal: false, cache_hits: 0, fresh_fetched: 0 };
  }

  const admin = createSupabaseAdminClient();
  const ids = nodes.map((p) => p.id);

  // ---- 1) 先撈 cache ----
  interface CacheRow {
    from_id: string;
    to_id: string;
    duration_minutes: number;
    distance_meters: number;
    source: string;
  }
  const { data: cached } = await admin
    .from("travel_time_cache")
    .select("from_id, to_id, duration_minutes, distance_meters, source")
    .in("from_id", ids)
    .in("to_id", ids)
    .returns<CacheRow[]>();
  const hitMap = new Map<string, CacheRow>();
  for (const r of cached ?? []) {
    hitMap.set(`${r.from_id}>${r.to_id}`, r);
  }

  // ---- 2) 填 cache hit 的 cell；收集 miss 的 (i, j) pair ----
  const missPairs: Array<[number, number]> = [];
  let cacheHits = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const key = `${nodes[i].id}>${nodes[j].id}`;
      const hit = hitMap.get(key);
      if (hit) {
        durationMinutes[i][j] = Number(hit.duration_minutes);
        distanceMeters[i][j] = Number(hit.distance_meters);
        cacheHits++;
      } else {
        missPairs.push([i, j]);
      }
    }
  }

  // ---- 3) 沒 miss → 全 hit，直接回 ----
  if (missPairs.length === 0) {
    return {
      durationMinutes, distanceMeters,
      isReal: (cached ?? []).every((r) => r.source === "tomtom"),
      cache_hits: cacheHits,
      fresh_fetched: 0
    };
  }

  // ---- 4) 有 miss 就重算整個矩陣（TomTom Matrix API 反正是 N×N 一口氣回） ----
  //   優化：未來可以實作「只算 missing rows」，但 TomTom 計費單位是請求數而非格子，
  //   所以一口氣算 N×N 跟單算少數一樣花 1 個 request；先簡單做。
  const fresh = await computeFresh(nodes);

  // 把所有 cell 填進 matrix（hit 的也覆蓋成新算的，反正一致）
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      durationMinutes[i][j] = fresh.durationMinutes[i][j];
      distanceMeters[i][j]  = fresh.distanceMeters[i][j];
    }
  }

  // ---- 5) Upsert 進 cache ----
  const rows: Array<{
    from_id: string; to_id: string;
    duration_minutes: number; distance_meters: number;
    source: string;
  }> = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      rows.push({
        from_id: nodes[i].id,
        to_id:   nodes[j].id,
        duration_minutes: Number(fresh.durationMinutes[i][j].toFixed(2)),
        distance_meters:  Math.round(fresh.distanceMeters[i][j]),
        source: fresh.isReal ? "tomtom" : "haversine"
      });
    }
  }
  // upsert 一次寫入（pk = (from_id, to_id)）
  const { error } = await admin
    .from("travel_time_cache")
    .upsert(rows, { onConflict: "from_id,to_id" });
  if (error) {
    console.warn("[matrix-cache] upsert failed:", error.message);
    // upsert 失敗也不影響本次回傳（只是下次還會重算）
  }

  return {
    durationMinutes, distanceMeters,
    isReal: fresh.isReal,
    cache_hits: cacheHits,
    fresh_fetched: missPairs.length
  };
}

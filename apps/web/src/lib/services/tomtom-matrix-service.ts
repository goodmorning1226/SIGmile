import "server-only";

/**
 * TomTom Routing Matrix (sync) helper.
 *
 * 用途：OR engine 要的 (n+1)×(n+1) 行車時間矩陣（depot + customers），
 *      若 stops 有 lat/lng，就 call TomTom 真實算；沒有 lat/lng 的 fallback 用 haversine + 平均 35 km/h。
 *
 * Docs:
 *   POST https://api.tomtom.com/routing/1/matrix/sync/json?key={KEY}
 *   Body: { "origins":[{"point":{"latitude":..,"longitude":..}}, ...],
 *           "destinations": [ ... ] }
 *   Response: { "matrix": [[ {statusCode,response:{routeSummary:{travelTimeInSeconds, lengthInMeters}}}, ... ]] }
 *
 * Limits (sync)：單次 origins×destinations ≤ 100。超過時這支 helper 會自動切成
 *   CHUNK×CHUNK 的子矩陣分批 call、再拼回完整 n×n。
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface MatrixResult {
  /** durationMinutes[i][j] — i 出發到 j 的行車時間（分鐘） */
  durationMinutes: number[][];
  /** distanceMeters[i][j] — i 到 j 的距離（公尺） */
  distanceMeters: number[][];
  /** 是否走 TomTom 真實 API（false = 用 haversine fallback） */
  isReal: boolean;
}

/** TomTom sync matrix 單次最大 cells；保守取 100 → 10×10 子矩陣。 */
const TOMTOM_CHUNK = 10;
/** 同時並發的子矩陣 call 數（避免 rate limit 429）。 */
const TOMTOM_CONCURRENCY = 4;

/**
 * 給一組座標（depot + stops），回傳 N×N 的時間矩陣（分鐘）。
 * 若 TOMTOM_API_KEY 未設或部分點缺座標，fallback 為 haversine 估算。
 *
 * 大矩陣（n > 10）會自動切 chunk 分批 call。
 */
export async function computeDurationMatrix(
  points: LatLng[]
): Promise<MatrixResult> {
  const apiKey = process.env.TOMTOM_API_KEY;
  const n = points.length;
  const allHaveCoords = points.every(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
  );

  if (!apiKey || !allHaveCoords || n < 2) {
    return haversineFallback(points);
  }

  // 先用 haversine 填底（個別 chunk 失敗時保底），再用 TomTom 真值覆寫成功的 cell
  const result = haversineFallback(points);
  result.isReal = false;

  // 切 chunk
  const chunks: { from: number; to: number }[] = [];
  for (let i = 0; i < n; i += TOMTOM_CHUNK) {
    chunks.push({ from: i, to: Math.min(i + TOMTOM_CHUNK, n) });
  }
  // 所有 (originChunk × destinationChunk) pairs
  const pairs: Array<{ o: { from: number; to: number }; d: { from: number; to: number } }> = [];
  for (const o of chunks) for (const d of chunks) pairs.push({ o, d });

  let anyReal = false;
  let allFailed = true;

  // 限制並發
  for (let i = 0; i < pairs.length; i += TOMTOM_CONCURRENCY) {
    const batch = pairs.slice(i, i + TOMTOM_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((p) => fetchSubMatrix(apiKey, points, p.o, p.d))
    );
    for (let k = 0; k < settled.length; k++) {
      const r = settled[k];
      const { o, d } = batch[k];
      if (r.status === "fulfilled") {
        const sub = r.value;
        allFailed = false;
        anyReal = true;
        for (let oi = 0; oi < o.to - o.from; oi++) {
          for (let di = 0; di < d.to - d.from; di++) {
            const dur = sub.dur[oi][di];
            const dis = sub.dis[oi][di];
            if (dur != null && Number.isFinite(dur)) {
              result.durationMinutes[o.from + oi][d.from + di] = dur;
              result.distanceMeters[o.from + oi][d.from + di] = dis;
            }
          }
        }
      } else {
        console.warn(
          `[tomtom-matrix] sub-matrix [${o.from}..${o.to})×[${d.from}..${d.to}) failed; using haversine for this block:`,
          r.reason
        );
      }
    }
  }

  if (allFailed) {
    // 全部 chunk 都失敗（網路 / API key 問題）→ 已經是 haversine fallback
    return result;
  }
  result.isReal = anyReal;
  return result;
}

async function fetchSubMatrix(
  apiKey: string,
  points: LatLng[],
  o: { from: number; to: number },
  d: { from: number; to: number }
): Promise<{ dur: number[][]; dis: number[][] }> {
  const origins = points.slice(o.from, o.to).map((p) => ({
    point: { latitude: p.lat, longitude: p.lng }
  }));
  const destinations = points.slice(d.from, d.to).map((p) => ({
    point: { latitude: p.lat, longitude: p.lng }
  }));
  const url = `https://api.tomtom.com/routing/1/matrix/sync/json?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ origins, destinations }),
    signal: AbortSignal.timeout(30_000)
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`TomTom Matrix ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = (await res.json()) as TomTomMatrixResponse;
  const rows = o.to - o.from;
  const cols = d.to - d.from;
  const dur: number[][] = Array.from({ length: rows }, () => Array(cols).fill(NaN));
  const dis: number[][] = Array.from({ length: rows }, () => Array(cols).fill(NaN));
  for (let i = 0; i < rows; i++) {
    const row = data.matrix[i];
    for (let j = 0; j < cols; j++) {
      const cell = row?.[j];
      if (cell?.statusCode === 200 && cell.response?.routeSummary) {
        dur[i][j] = cell.response.routeSummary.travelTimeInSeconds / 60;
        dis[i][j] = cell.response.routeSummary.lengthInMeters;
      }
    }
  }
  return { dur, dis };
}

interface TomTomMatrixResponse {
  matrix: Array<
    Array<{
      statusCode: number;
      response?: { routeSummary: { travelTimeInSeconds: number; lengthInMeters: number } };
    }>
  >;
}

function haversinePair(a: LatLng, b: LatLng): { meters: number; minutes: number } {
  if (!Number.isFinite(a.lat) || !Number.isFinite(b.lat)) {
    return { meters: 0, minutes: 0 };
  }
  const R = 6371000; // m
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const meters = 2 * R * Math.asin(Math.sqrt(h));
  // 假設市區平均 30 km/h
  const minutes = (meters / 1000) / 30 * 60;
  return { meters, minutes };
}

function haversineFallback(points: LatLng[]): MatrixResult {
  const n = points.length;
  const durationMinutes: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const distanceMeters: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const { meters, minutes } = haversinePair(points[i], points[j]);
      distanceMeters[i][j] = meters;
      durationMinutes[i][j] = minutes;
    }
  }
  return { durationMinutes, distanceMeters, isReal: false };
}

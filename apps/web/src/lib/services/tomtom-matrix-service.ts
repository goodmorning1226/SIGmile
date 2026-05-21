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
 * Limits (sync): origins×destinations <= 700, max 100 per side. 對 MVP（<=15 stops）夠用。
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

/**
 * 給一組座標（depot + stops），回傳 N×N 的時間矩陣（分鐘）。
 * 若 TOMTOM_API_KEY 未設或部分點缺座標，fallback 為 haversine 估算。
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

  const origins = points.map((p) => ({ point: { latitude: p.lat, longitude: p.lng } }));
  const destinations = origins;

  try {
    const url = `https://api.tomtom.com/routing/1/matrix/sync/json?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ origins, destinations }),
      // Routing Matrix sync 可能跑數秒，給 30 秒 timeout
      signal: AbortSignal.timeout(30_000)
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`TomTom Matrix ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = (await res.json()) as TomTomMatrixResponse;
    const durationMinutes: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
    const distanceMeters: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      const row = data.matrix[i];
      for (let j = 0; j < n; j++) {
        const cell = row?.[j];
        if (cell?.statusCode === 200 && cell.response?.routeSummary) {
          durationMinutes[i][j] = cell.response.routeSummary.travelTimeInSeconds / 60;
          distanceMeters[i][j] = cell.response.routeSummary.lengthInMeters;
        } else {
          // 個別 pair 失敗 → 該 cell 用 haversine 補
          const fb = haversinePair(points[i], points[j]);
          durationMinutes[i][j] = fb.minutes;
          distanceMeters[i][j] = fb.meters;
        }
      }
    }
    return { durationMinutes, distanceMeters, isReal: true };
  } catch (err) {
    console.warn("[tomtom-matrix] fallback to haversine:", err);
    return haversineFallback(points);
  }
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

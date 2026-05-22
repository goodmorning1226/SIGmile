/**
 * 距離與時間計算 — 純函式、無依賴。
 *
 * 給 OR 算法層（sweep / VRPTW / TSP）共用。
 * 不打 TomTom API；那是 ortools-bridge 的事。這層只負責「在沒有 matrix 的時候」
 * 用 haversine 估出來，避免算法層需要 await。
 */

const EARTH_RADIUS_M = 6_371_000;
const TAIWAN_AVG_KMH = 28; // 北部 + 雙北市區平均，含號誌、紅綠燈

export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance in metres (Haversine). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** 估算「分鐘」— Taiwan urban average. 真實 matrix 進來時這個會被忽略。 */
export function estimateMinutes(distanceMeters: number, avgKmh = TAIWAN_AVG_KMH): number {
  return (distanceMeters / 1000) / avgKmh * 60;
}

/** 建 N×N matrix。N 包含 depot；index 0 = depot。 */
export function buildHaversineMatrix(points: LatLng[]): {
  distance_m: number[][];
  time_min: number[][];
} {
  const n = points.length;
  const distance_m: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const time_min:   number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = haversineMeters(points[i], points[j]);
      distance_m[i][j] = d;
      distance_m[j][i] = d;
      const t = estimateMinutes(d);
      time_min[i][j] = t;
      time_min[j][i] = t;
    }
  }
  return { distance_m, time_min };
}

/** 極角座標 — sweep 算法用。回傳弧度（-π, π]。0 = 正東；逆時針為正。 */
export function polarAngle(depot: LatLng, point: LatLng): number {
  // 用平面近似（小區域足夠精確）；正東 = +x，正北 = +y
  const dx = point.lng - depot.lng;
  const dy = point.lat - depot.lat;
  return Math.atan2(dy, dx);
}

/** 路線總長 — 含 depot 來回。 */
export function routeLengthMeters(
  matrix: number[][],
  /** stop indices 順序，**不含** depot；depot 永遠是 0。 */
  route: number[]
): number {
  if (route.length === 0) return 0;
  let total = matrix[0][route[0]];
  for (let i = 0; i + 1 < route.length; i++) {
    total += matrix[route[i]][route[i + 1]];
  }
  total += matrix[route[route.length - 1]][0];
  return total;
}

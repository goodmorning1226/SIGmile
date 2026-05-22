import "server-only";

/**
 * Route Map Service — 給 driver detail 頁/route plan 視覺化用。
 *
 *  - 呼叫 TomTom Calculate Route API 取得「沿路 polyline」
 *  - 組好 TomTom Static Map URL 給前端 <img> 當底圖
 *  - 算 bbox 給前端做 Web Mercator 投影對齊
 *
 * 前端拿到後渲染：<img src={staticMapUrl}> 底圖 + 上面用 SVG overlay
 * 畫 polyline + 編號 markers。
 */

export interface RoutePoint { lat: number; lng: number; }
export interface RouteMarker {
  lat: number;
  lng: number;
  /** 顯示名稱（站名 / DC） */
  label: string;
  /** depot 用方塊圖案、stop 用編號圈 */
  kind: "depot" | "stop";
  /** stop 的序號（1 起） */
  index?: number;
  /** stop 狀態（completed/pending/...）— 影響顏色 */
  status?: string;
}

export interface RouteBBox {
  minLat: number; maxLat: number;
  minLng: number; maxLng: number;
}

export interface RouteMapData {
  markers: RouteMarker[];
  /** 沿著真實道路的折線；若 TomTom 失敗則 fallback 為直線連 markers */
  polyline: RoutePoint[];
  /** 包含所有 markers 的 bbox（已加 padding） */
  bbox: RouteBBox;
  /** Static map URL；無 API key 時為 null（前端會 fallback 純灰底） */
  staticMapUrl: string | null;
  /** 圖片寬高（給前端 SVG overlay 對齊） */
  mapWidth: number;
  mapHeight: number;
  /** 是否真的有從 TomTom 取得 polyline */
  isRealPolyline: boolean;
}

interface CalculateRouteResponse {
  routes?: Array<{
    legs?: Array<{
      points?: Array<{ latitude: number; longitude: number }>;
    }>;
  }>;
}

const DEFAULT_W = 960;
const DEFAULT_H = 560;

export async function getRouteMapData(opts: {
  depot: RoutePoint | null;
  /** 已依配送順序排序 */
  stops: Array<{ lat: number; lng: number; name: string; order: number; status?: string }>;
  mapWidth?: number;
  mapHeight?: number;
}): Promise<RouteMapData | null> {
  const { depot, stops } = opts;
  const mapWidth = opts.mapWidth ?? DEFAULT_W;
  const mapHeight = opts.mapHeight ?? DEFAULT_H;
  const apiKey = process.env.TOMTOM_API_KEY;

  // 至少要有一個有效座標才能畫
  const hasValid = (depot && Number.isFinite(depot.lat) && Number.isFinite(depot.lng)) ||
    stops.some((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  if (!hasValid) return null;

  // ─── markers ───
  const markers: RouteMarker[] = [];
  if (depot && Number.isFinite(depot.lat) && Number.isFinite(depot.lng)) {
    markers.push({ lat: depot.lat, lng: depot.lng, label: "物流中心", kind: "depot" });
  }
  for (const s of stops) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    markers.push({
      lat: s.lat, lng: s.lng,
      label: s.name,
      kind: "stop",
      index: s.order,
      status: s.status
    });
  }

  // ─── bbox（加 padding，避免 markers 貼到圖邊） ───
  const lats = markers.map((m) => m.lat);
  const lngs = markers.map((m) => m.lng);
  const rawBBox = {
    minLat: Math.min(...lats), maxLat: Math.max(...lats),
    minLng: Math.min(...lngs), maxLng: Math.max(...lngs)
  };
  // 至少給一點寬度，避免單點時 bbox 是 0
  const latSpan = Math.max(rawBBox.maxLat - rawBBox.minLat, 0.01);
  const lngSpan = Math.max(rawBBox.maxLng - rawBBox.minLng, 0.01);
  const padLat = latSpan * 0.15;
  const padLng = lngSpan * 0.15;
  const bbox: RouteBBox = {
    minLat: rawBBox.minLat - padLat,
    maxLat: rawBBox.maxLat + padLat,
    minLng: rawBBox.minLng - padLng,
    maxLng: rawBBox.maxLng + padLng
  };

  // ─── polyline ───
  let polyline: RoutePoint[] = [];
  let isRealPolyline = false;
  // 把 depot → stops → depot 串成 waypoints
  const waypointObjs: RoutePoint[] = [];
  if (depot) waypointObjs.push(depot);
  for (const s of stops) {
    if (Number.isFinite(s.lat) && Number.isFinite(s.lng)) {
      waypointObjs.push({ lat: s.lat, lng: s.lng });
    }
  }
  if (depot) waypointObjs.push(depot);

  if (apiKey && waypointObjs.length >= 2) {
    try {
      const waypointsStr = waypointObjs
        .map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`)
        .join(":");
      const url =
        `https://api.tomtom.com/routing/1/calculateRoute/${waypointsStr}/json` +
        `?key=${encodeURIComponent(apiKey)}` +
        `&routeType=fastest&travelMode=car&computeBestOrder=false`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        cache: "no-store"
      });
      if (res.ok) {
        const data = (await res.json()) as CalculateRouteResponse;
        const points: RoutePoint[] = [];
        for (const leg of data.routes?.[0]?.legs ?? []) {
          for (const p of leg.points ?? []) {
            if (Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) {
              points.push({ lat: p.latitude, lng: p.longitude });
            }
          }
        }
        if (points.length >= 2) {
          polyline = points;
          isRealPolyline = true;
        }
      } else {
        const txt = await res.text();
        console.warn(`[route-map] TomTom Calculate Route ${res.status}:`, txt.slice(0, 160));
      }
    } catch (e) {
      console.warn("[route-map] Calculate Route failed:", e);
    }
  }
  // fallback：用 marker 直線連
  if (polyline.length === 0) {
    polyline = waypointObjs.map((p) => ({ lat: p.lat, lng: p.lng }));
  }

  // ─── Static Map URL ───
  let staticMapUrl: string | null = null;
  if (apiKey) {
    staticMapUrl =
      `https://api.tomtom.com/map/1/staticimage?` +
      `key=${encodeURIComponent(apiKey)}` +
      `&bbox=${bbox.minLng.toFixed(6)},${bbox.minLat.toFixed(6)},` +
            `${bbox.maxLng.toFixed(6)},${bbox.maxLat.toFixed(6)}` +
      `&width=${mapWidth}&height=${mapHeight}` +
      `&layer=basic&style=main&format=png&view=Unified`;
  }

  return { markers, polyline, bbox, staticMapUrl, mapWidth, mapHeight, isRealPolyline };
}

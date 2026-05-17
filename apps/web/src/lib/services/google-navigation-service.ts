import "server-only";

export interface LatLng { lat: number; lng: number; }
export interface TravelEstimate { minutes: number; distanceMeters: number; }

/**
 * 導航 / 距離估算服務。
 *
 * MVP：全部 mock。
 *   - 未來替換點：把 `MockGoogleNavigationService` 換成 `RealGoogleNavigationService`，
 *     呼叫 Google Routes API（distance matrix / directions）即可，呼叫端介面不變。
 *   - 旅行時間 mock 用 Haversine + 平均速度 25km/h。
 */
export interface IGoogleNavigationService {
  getNextDestination(currentStopId: string | null): Promise<{ stopId: string | null }>;
  buildNavigationUrl(to: LatLng): Promise<string>;
  estimateTravelTime(from: LatLng, to: LatLng): Promise<TravelEstimate>;
}

export class MockGoogleNavigationService implements IGoogleNavigationService {
  async getNextDestination(currentStopId: string | null) {
    // 真實邏輯由 DeliveryTaskService 決定；這裡保留介面以便未來介接 Google Routes API。
    return { stopId: currentStopId };
  }

  async buildNavigationUrl(to: LatLng) {
    return `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}`;
  }

  async estimateTravelTime(from: LatLng, to: LatLng): Promise<TravelEstimate> {
    const distanceMeters = haversineMeters(from, to);
    const avgSpeedMps = (25 * 1000) / 3600; // 25 km/h
    const minutes = Math.max(1, Math.round(distanceMeters / avgSpeedMps / 60));
    return { minutes, distanceMeters: Math.round(distanceMeters) };
  }
}

function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sa = Math.sin(dLat / 2);
  const sb = Math.sin(dLng / 2);
  const h = sa * sa + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sb * sb;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 預留：未來真實版本骨架
// export class RealGoogleNavigationService implements IGoogleNavigationService { ... }

export const googleNavigationService: IGoogleNavigationService =
  process.env.GOOGLE_MAPS_API_KEY ? new MockGoogleNavigationService() /* TODO swap */
                                  : new MockGoogleNavigationService();

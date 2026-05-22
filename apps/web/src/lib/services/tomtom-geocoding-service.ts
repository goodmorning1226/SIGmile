import "server-only";

/**
 * TomTom Geocoding API helper.
 *
 * 用法：丟一個地址字串 → 拿到 (lat, lng)。
 *
 * Docs:
 *   GET https://api.tomtom.com/search/2/geocode/{query}.json?key={KEY}&countrySet=TW&limit=1
 *
 * Free tier: 2500 requests/day。對 MVP 34 個門市綽綽有餘。
 */

export interface GeocodeResult {
  lat: number;
  lng: number;
  matched_address?: string;
  confidence?: number;
}

/**
 * 把單一地址轉成 lat/lng。失敗回 null（addr 空 / API 沒 key / 找不到 / network error）。
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) {
    console.warn("[tomtom-geocode] TOMTOM_API_KEY not set");
    return null;
  }
  const q = address.trim();
  if (!q) return null;

  const url =
    `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(q)}.json` +
    `?key=${apiKey}&countrySet=TW&limit=1&language=zh-TW`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000)
    });
    if (!res.ok) {
      console.warn(`[tomtom-geocode] ${res.status} for "${q.slice(0, 30)}..."`);
      return null;
    }
    const data = (await res.json()) as TomTomGeocodeResponse;
    const hit = data.results?.[0];
    if (!hit?.position) return null;
    return {
      lat: hit.position.lat,
      lng: hit.position.lon,
      matched_address: hit.address?.freeformAddress,
      confidence: hit.score
    };
  } catch (err) {
    console.warn(`[tomtom-geocode] error for "${q.slice(0, 30)}...":`, err);
    return null;
  }
}

interface TomTomGeocodeResponse {
  results?: Array<{
    score?: number;
    position?: { lat: number; lon: number };
    address?: { freeformAddress?: string };
  }>;
}

/**
 * 批次 geocode（rate-limited，序列呼叫避免撞 TomTom QPS）。
 * 預設每個請求 100 ms 間隔。
 */
export async function geocodeBatch(
  inputs: Array<{ id: string; address: string }>,
  options: { gapMs?: number } = {}
): Promise<Array<{ id: string; ok: boolean; lat?: number; lng?: number; matched_address?: string; error?: string }>> {
  const gap = options.gapMs ?? 100;
  const out: Array<{ id: string; ok: boolean; lat?: number; lng?: number; matched_address?: string; error?: string }> = [];
  for (let i = 0; i < inputs.length; i++) {
    const { id, address } = inputs[i];
    if (!address || !address.trim()) {
      out.push({ id, ok: false, error: "empty_address" });
      continue;
    }
    try {
      const r = await geocodeAddress(address);
      if (!r) {
        out.push({ id, ok: false, error: "not_found" });
      } else {
        out.push({
          id, ok: true,
          lat: r.lat, lng: r.lng,
          matched_address: r.matched_address
        });
      }
    } catch (e) {
      out.push({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    if (i < inputs.length - 1 && gap > 0) {
      await new Promise((res) => setTimeout(res, gap));
    }
  }
  return out;
}

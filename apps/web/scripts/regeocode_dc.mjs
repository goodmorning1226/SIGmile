// 一次性：把 distribution_centers 主檔的 DC 用 TomTom Geocoding API 重算 lat/lng 後寫回。
//
// 跑法：node apps/web/scripts/regeocode_dc.mjs
//
// 預期：把預設 DC（id = 11111111-aaaa-1111-aaaa-111111111111）的位置改成
//   名稱：桃園中壢配送中心
//   地址：320桃園市中壢區復興里自強一路111號
// TomTom 算出來的 lat/lng 自動寫回 DB。
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env.local");
const env = {};
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m) env[m[1]] = m[2].trim();
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE_KEY;
const TOMTOM_KEY   = env.TOMTOM_API_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE || !TOMTOM_KEY) {
  console.error("Missing env vars. Need NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / TOMTOM_API_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// ── 預期 DC 資料 ──
const DC_ID      = "11111111-aaaa-1111-aaaa-111111111111";
const DC_CODE    = "DC-TYN-01";
const DC_NAME    = "桃園中壢配送中心";
const DC_ADDRESS = "320桃園市中壢區復興里自強一路111號";

async function geocode(address) {
  const url = `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(address)}.json` +
              `?key=${TOMTOM_KEY}&countrySet=TW&limit=1&language=zh-TW`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    const txt = await res.text();
    return { ok: false, error: `HTTP ${res.status}: ${txt.slice(0, 200)}` };
  }
  const data = await res.json();
  const hit = data.results?.[0];
  if (!hit?.position) return { ok: false, error: "not_found" };
  return {
    ok: true,
    lat: hit.position.lat,
    lng: hit.position.lon,
    matched: hit.address?.freeformAddress ?? null,
    score: hit.score ?? null
  };
}

async function main() {
  console.log(`Geocoding: ${DC_ADDRESS}`);
  const g = await geocode(DC_ADDRESS);
  if (!g.ok) {
    console.error("✗ Geocode failed:", g.error);
    process.exit(1);
  }
  console.log(`✓ lat=${g.lat.toFixed(6)}, lng=${g.lng.toFixed(6)}  (matched: ${g.matched}, score ${(g.score ?? 0).toFixed(2)})`);

  // upsert DC row（id 固定，所有外鍵都指這個 id）
  const { error } = await supabase
    .from("distribution_centers")
    .upsert(
      {
        id: DC_ID,
        code: DC_CODE,
        name: DC_NAME,
        address: DC_ADDRESS,
        lat: g.lat,
        lng: g.lng,
        is_active: true
      },
      { onConflict: "id" }
    );
  if (error) {
    console.error("✗ Upsert failed:", error.message);
    process.exit(1);
  }
  console.log("✓ DC updated.");

  // 順便讓 travel_time_cache 在下次 OR run 重算（cache 是以 from_id/to_id 為 key，
  // DC 的 id 沒變，但座標換了 → 用 trigger 自動 invalidate；travel_time_cache migration
  // 已經建好相應 trigger，這裡不用特別處理）
  console.log("\nDone. 如果之前已用舊 DC 座標跑過 OR / 算過 travel_time_cache，建議：");
  console.log("  1) 跑 node apps/web/scripts/seed_duration_matrix_from_or.mjs 重灌 matrix cache");
  console.log("  2) 重跑 demo_routes_from_or.sql 重新建 demo 路線");
}

main().catch((e) => { console.error(e); process.exit(1); });

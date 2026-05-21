// 一次性腳本：把所有 active stops 用 TomTom Geocoding API 重算 lat/lng 後寫回 DB
// 跑法：node apps/web/scripts/regeocode_all_stops.mjs
//
// 讀取 apps/web/.env.local 拿三把 key（SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / TOMTOM_API_KEY）
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

async function geocode(address) {
  const url = `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(address)}.json` +
              `?key=${TOMTOM_KEY}&countrySet=TW&limit=1&language=zh-TW`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
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
  console.log("Fetching all active stops…");
  const { data: stops, error } = await supabase
    .from("stops")
    .select("id, external_code, name, address, lat, lng")
    .eq("is_active", true)
    .order("external_code", { ascending: true });
  if (error) { console.error(error); process.exit(1); }
  console.log(`Got ${stops.length} stops`);

  let ok = 0, fail = 0;
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    process.stdout.write(`[${(i + 1).toString().padStart(2)}/${stops.length}] ${s.external_code ?? s.id.slice(0, 6)}  ${(s.name ?? "").padEnd(8)} `);
    const g = await geocode(s.address);
    if (!g.ok) {
      console.log(`  ✗ ${g.error}`);
      fail++;
    } else {
      const { error: upErr } = await supabase
        .from("stops")
        .update({ lat: g.lat, lng: g.lng })
        .eq("id", s.id);
      if (upErr) {
        console.log(`  ✗ update: ${upErr.message}`);
        fail++;
      } else {
        console.log(`  ✓ ${g.lat.toFixed(5)}, ${g.lng.toFixed(5)}  (score ${(g.score ?? 0).toFixed(2)})`);
        ok++;
      }
    }
    // 100ms 間隔避免撞 TomTom QPS
    await new Promise((r) => setTimeout(r, 120));
  }
  console.log(`\nDone. ${ok} updated, ${fail} failed.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

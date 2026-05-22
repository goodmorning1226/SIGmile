// 一次性腳本：把 OR/duration_matrix_with_service_time.csv 灌進 travel_time_cache
// 之後 OR run 直接 cache 命中，不用打 TomTom。
//
// 跑法：node apps/web/scripts/seed_duration_matrix_from_or.mjs
//
// CSV 格式：
//   row 0 (header):  ['', '0', store_id_1, ..., store_id_n, 'service_time']
//   row 1 (depot):   ['0',  0,   τ(0,1),  ..., τ(0,n), 0]
//   rows 2..n+1 (stores): [store_id, τ(s,0), 0(self), τ(s,*)..., σ_s]
//
// 寫入 cache：對每個 (i, j), i != j 插一筆 (from_id, to_id, duration_minutes)
//   - i=0  → depot id (distribution_centers.id)
//   - i>0  → stops.id (用 external_code 查)
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = resolve(__dirname, "..", "..", "..");
const envPath   = resolve(__dirname, "..", ".env.local");
const csvPath   = resolve(repoRoot, "OR", "duration_matrix_with_service_time.csv");

// ---- env ----
const env = {};
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m) env[m[1]] = m[2].trim();
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// ---- parse CSV ----
function parseCsv(txt) {
  // 去掉 UTF-8 BOM
  if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
  return txt.trim().split(/\r?\n/).map((line) => line.split(",").map((c) => c.trim()));
}

async function main() {
  console.log(`Reading ${csvPath}`);
  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  const header = rows[0];
  // header: ['', '0', '243812', '187323', ..., '153593', 'service_time']
  //          col0 blank, col1 depot label, col2..N store_no, last col 'service_time'
  // matrix size (depot + customers) = header.length - 2
  const matrixSize = header.length - 2;             // e.g. 35 = depot + 34 stores
  const nStops = matrixSize - 1;                    // 34
  console.log(`Matrix size: ${matrixSize} × ${matrixSize} (depot + ${nStops} stops)`);

  // col labels: depot, header[2], header[3], ..., header[matrixSize]
  const colLabels = ["depot", ...header.slice(2, 2 + nStops)];
  // data rows: rows[1..matrixSize] (matrixSize rows total)
  const matrixRows = rows.slice(1);
  if (matrixRows.length !== matrixSize) {
    throw new Error(`Expected ${matrixSize} data rows, got ${matrixRows.length}`);
  }

  const rowLabels = matrixRows.map((r, i) => i === 0 ? "depot" : r[0]);

  // ---- 查 distribution_center id (depot) ----
  const { data: dcs, error: dcErr } = await supabase
    .from("distribution_centers")
    .select("id, code")
    .limit(1);
  if (dcErr) throw dcErr;
  if (!dcs?.length) throw new Error("No distribution_centers found");
  const depotId = dcs[0].id;
  console.log(`Depot: ${dcs[0].code} (${depotId})`);

  // ---- 查 stops.external_code → stops.id ----
  const storeCodes = colLabels.slice(1);
  const { data: stops, error: sErr } = await supabase
    .from("stops")
    .select("id, external_code")
    .in("external_code", storeCodes);
  if (sErr) throw sErr;
  const codeToId = new Map(stops.map((s) => [s.external_code, s.id]));
  console.log(`Matched ${codeToId.size} / ${storeCodes.length} stores`);

  const missingCodes = storeCodes.filter((c) => !codeToId.has(c));
  if (missingCodes.length > 0) {
    console.error(`Missing stops in DB for external_codes: ${missingCodes.join(", ")}`);
    console.error("Run demo_reset_mvp.sql first to seed 34 MVP stops.");
    process.exit(1);
  }

  // ---- 建 label → uuid map ----
  function labelToId(label) {
    if (label === "depot") return depotId;
    return codeToId.get(label);
  }

  // ---- 組 (from_id, to_id, duration_minutes, distance_meters, source) 列表 ----
  const cacheRows = [];
  for (let i = 0; i < matrixSize; i++) {
    const fromId = labelToId(rowLabels[i]);
    const dataRow = matrixRows[i];
    // dataRow: [label, τ(i,0), τ(i,1), ..., τ(i,matrixSize-1), σ_i]
    for (let j = 0; j < matrixSize; j++) {
      if (i === j) continue;
      const toId = labelToId(colLabels[j]);
      const durStr = dataRow[j + 1];  // dataRow[0]=label; dataRow[1]=τ(i,0)
      const duration = parseFloat(durStr);
      if (!Number.isFinite(duration)) {
        console.warn(`  skip non-numeric: i=${i} j=${j} val="${durStr}"`);
        continue;
      }
      cacheRows.push({
        from_id: fromId,
        to_id: toId,
        duration_minutes: Math.round(duration * 100) / 100,
        // CSV 沒有距離欄位；用 duration × 600m/min (~35km/h) 粗估
        distance_meters: Math.round(duration * 600),
        source: "or-csv"
      });
    }
  }

  console.log(`Built ${cacheRows.length} cache rows (${matrixSize}² - ${matrixSize} self-pairs)`);

  // ---- 整批 upsert（pk = (from_id, to_id)） ----
  // Supabase upsert 一次最多幾百筆，1156 筆要分批
  const BATCH = 500;
  let done = 0;
  for (let off = 0; off < cacheRows.length; off += BATCH) {
    const batch = cacheRows.slice(off, off + BATCH);
    const { error: upErr } = await supabase
      .from("travel_time_cache")
      .upsert(batch, { onConflict: "from_id,to_id" });
    if (upErr) {
      console.error(`Upsert failed at offset ${off}:`, upErr.message);
      process.exit(1);
    }
    done += batch.length;
    process.stdout.write(`\rUpserted ${done}/${cacheRows.length}`);
  }
  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });

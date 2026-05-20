import * as XLSX from "xlsx";
import { requireManager } from "@/lib/auth/server-auth";
import { ok, fail, handleApiError } from "@/lib/api/response";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/manager/stops/import
 *   multipart/form-data 上傳 xlsx，依「停靠點代碼 (external_code)」做 upsert：
 *     - 有同 external_code → update
 *     - 沒有 → insert
 *   找不到 external_code 的列以 (name + address) 做匹配。
 */
export async function POST(request: Request) {
  try {
    await requireManager();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return fail("BAD_REQUEST", "請上傳 xlsx 檔案（欄位名 file）", 400);
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    if (!ws) return fail("BAD_REQUEST", "Excel 沒有任何工作表", 400);

    // 先把每一列轉成 array of array；用第一列當 header
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, blankrows: false });
    if (rows.length < 2) {
      return fail("BAD_REQUEST", "Excel 內容為空", 400);
    }
    const header = rows[0].map((h) => String(h).trim());
    const headerIndex = (label: string) => header.findIndex((h) => h.includes(label));

    // 寬鬆對應：依 label 子字串找欄位 index
    const idx = {
      code:    headerIndex("代碼"),
      name:    headerIndex("名稱"),
      address: headerIndex("地址"),
      city:    headerIndex("縣市"),
      district:headerIndex("行政區"),
      lat:     headerIndex("緯度"),
      lng:     headerIndex("經度"),
      twStart: headerIndex("時窗起"),
      twEnd:   headerIndex("時窗迄"),
      service: headerIndex("停留"),
      volume:  headerIndex("貨量"),
      temp:    headerIndex("溫層"),
      shift:   headerIndex("班別"),
      special: headerIndex("特殊車輛"),
      contact: headerIndex("聯絡人"),
      phone:   headerIndex("電話"),
      notes:   headerIndex("備註")
    };

    if (idx.name < 0 || idx.address < 0) {
      return fail("BAD_REQUEST", "Excel 必須包含「名稱」與「地址」欄", 400);
    }

    const admin = createSupabaseAdminClient();
    let inserted = 0;
    let updated  = 0;
    const errors: string[] = [];

    const normTime = (v: any) => {
      if (v == null || v === "") return null;
      const s = String(v).trim();
      if (/^\d{1,2}:\d{2}$/.test(s)) return `${s}:00`;
      if (/^\d{1,2}:\d{2}:\d{2}$/.test(s)) return s;
      return null;
    };
    const normNum = (v: any) => {
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const normStr = (v: any) => {
      if (v == null) return null;
      const s = String(v).trim();
      return s === "" ? null : s;
    };
    const normEnum = (v: any, allowed: string[]) => {
      const s = normStr(v);
      if (!s) return null;
      return allowed.includes(s) ? s : null;
    };

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;
      const name = normStr(row[idx.name]);
      const address = normStr(row[idx.address]);
      if (!name || !address) continue;

      const payload: Record<string, any> = {
        name,
        address,
        external_code:       idx.code     >= 0 ? normStr(row[idx.code])    : null,
        city:                idx.city     >= 0 ? normStr(row[idx.city])    : null,
        district:            idx.district >= 0 ? normStr(row[idx.district]): null,
        lat:                 idx.lat      >= 0 ? normNum(row[idx.lat])     : null,
        lng:                 idx.lng      >= 0 ? normNum(row[idx.lng])     : null,
        time_window_start:   idx.twStart  >= 0 ? normTime(row[idx.twStart]): null,
        time_window_end:     idx.twEnd    >= 0 ? normTime(row[idx.twEnd])  : null,
        default_service_minutes: idx.service >= 0
          ? (normNum(row[idx.service]) ?? 10) : 10,
        avg_delivery_volume: idx.volume   >= 0 ? normNum(row[idx.volume])  : null,
        temperature_type:    idx.temp     >= 0
          ? normEnum(row[idx.temp], ["frozen","chilled","mixed","ambient"]) : null,
        shift:               idx.shift    >= 0
          ? normEnum(row[idx.shift], ["day","night"]) : null,
        special_vehicle_requirement: idx.special >= 0 ? normStr(row[idx.special]) : null,
        contact_name:        idx.contact  >= 0 ? normStr(row[idx.contact]) : null,
        contact_phone:       idx.phone    >= 0 ? normStr(row[idx.phone])   : null,
        notes:               idx.notes    >= 0 ? normStr(row[idx.notes])   : null
      };

      // 嘗試 update by external_code，否則 insert
      if (payload.external_code) {
        const { data: existing } = await admin
          .from("stops")
          .select("id")
          .eq("external_code", payload.external_code)
          .maybeSingle();
        if (existing?.id) {
          const { error: upErr } = await admin
            .from("stops").update(payload).eq("id", existing.id);
          if (upErr) errors.push(`row ${r+1}: ${upErr.message}`);
          else updated++;
          continue;
        }
      }
      const { error: insErr } = await admin.from("stops").insert(payload);
      if (insErr) errors.push(`row ${r+1}: ${insErr.message}`);
      else inserted++;
    }

    return ok({
      inserted, updated,
      total_rows: rows.length - 1,
      errors: errors.slice(0, 20)   // 最多 20 筆錯誤
    });
  } catch (e) {
    return handleApiError(e);
  }
}

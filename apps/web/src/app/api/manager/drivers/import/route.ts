import * as XLSX from "xlsx";
import { requireManager } from "@/lib/auth/server-auth";
import { ok, fail, handleApiError } from "@/lib/api/response";
import { createDriver } from "@/lib/services/driver-admin-service";
import type { ShiftType, TemperatureType } from "@/types/domain";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/manager/drivers/import
 *   multipart/form-data 上傳 xlsx，逐列建/upsert 物流士。
 *   email 是 key（已存在的 auth user 沿用 + 只 upsert profile；不存在就建新）。
 *
 * 回傳：created/updated/failed 計數 + 失敗列的錯誤訊息 + 新建者的初始密碼（一次性提示）。
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

    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
    if (rows.length < 2) {
      return fail("BAD_REQUEST", "Excel 內容為空", 400);
    }
    const header = (rows[0] as unknown[]).map((h) => String(h ?? "").trim());
    const idx = (label: string) => header.findIndex((h) => h.includes(label));

    const cols = {
      code:     idx("員編"),
      name:     idx("姓名"),
      email:    idx("Email") >= 0 ? idx("Email") : idx("email"),
      phone:    idx("電話"),
      shift:    idx("班別"),
      maxWork:  idx("工時"),
      vehId:    idx("車輛代號"),
      vehType:  idx("車輛類型"),
      vehCap:   idx("車輛容量"),
      tempCap:  idx("溫層"),
      active:   idx("啟用")
    };

    if (cols.email < 0 || cols.name < 0) {
      return fail("BAD_REQUEST", "Excel 必須有「Email」與「姓名」欄", 400);
    }

    const created: Array<{ email: string; password: string }> = [];
    const updated: string[] = [];
    const errors: string[] = [];

    const normStr = (v: unknown): string | null => {
      if (v == null) return null;
      const s = String(v).trim();
      return s === "" ? null : s;
    };
    const normNum = (v: unknown): number | null => {
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const normEnum = <T extends string>(v: unknown, allowed: T[]): T | null => {
      const s = normStr(v);
      if (!s) return null;
      return (allowed as string[]).includes(s) ? (s as T) : null;
    };

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] as unknown[];
      if (!row || row.length === 0) continue;
      const email = normStr(row[cols.email]);
      const name  = normStr(row[cols.name]);
      if (!email || !name) continue;

      try {
        const result = await createDriver({
          email,
          full_name: name,
          phone:                  cols.phone   >= 0 ? normStr(row[cols.phone])   : null,
          employee_code:          cols.code    >= 0 ? normStr(row[cols.code])    : null,
          shift:                  cols.shift   >= 0
            ? normEnum<ShiftType>(row[cols.shift], ["day", "night"])
            : null,
          max_work_minutes:       cols.maxWork >= 0 ? normNum(row[cols.maxWork]) : null,
          vehicle_id:             cols.vehId   >= 0 ? normStr(row[cols.vehId])   : null,
          vehicle_type:           cols.vehType >= 0 ? normStr(row[cols.vehType]) : null,
          vehicle_capacity:       cols.vehCap  >= 0 ? normNum(row[cols.vehCap])  : null,
          temperature_capability: cols.tempCap >= 0
            ? normEnum<TemperatureType>(row[cols.tempCap], ["frozen","chilled","mixed","ambient"])
            : null
        });
        if (result.reused_existing) {
          updated.push(email);
        } else {
          created.push({ email, password: result.password });
        }
      } catch (e) {
        errors.push(`row ${r + 1} (${email}): ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return ok({
      total_rows: rows.length - 1,
      created_count: created.length,
      updated_count: updated.length,
      created,                 // 含新建司機的初始密碼
      updated_emails: updated.slice(0, 20),
      errors: errors.slice(0, 20)
    });
  } catch (e) {
    return handleApiError(e);
  }
}

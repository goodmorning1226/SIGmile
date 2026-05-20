import * as XLSX from "xlsx";
import { requireManager } from "@/lib/auth/server-auth";
import { handleApiError } from "@/lib/api/response";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/manager/stops/export
 *   下載「目前所有停靠點」xlsx，欄位對齊 OR 04 表 + Phase 2 新增屬性。
 *   主管可以在 Excel 改完後用 import 灌回。
 */
export async function GET() {
  try {
    await requireManager();
    const admin = createSupabaseAdminClient();

    interface Row {
      external_code: string | null;
      name: string;
      address: string;
      city: string | null;
      district: string | null;
      lat: number | null;
      lng: number | null;
      time_window_start: string | null;
      time_window_end: string | null;
      default_service_minutes: number;
      avg_delivery_volume: number | null;
      temperature_type: string | null;
      shift: string | null;
      special_vehicle_requirement: string | null;
      contact_name: string | null;
      contact_phone: string | null;
      notes: string | null;
    }
    const { data, error } = await admin
      .from("stops")
      .select(
        "external_code, name, address, city, district, lat, lng, " +
          "time_window_start, time_window_end, default_service_minutes, " +
          "avg_delivery_volume, temperature_type, shift, " +
          "special_vehicle_requirement, contact_name, contact_phone, notes"
      )
      .eq("is_active", true)
      .order("external_code", { ascending: true })
      .returns<Row[]>();
    if (error) throw error;

    // 中文標頭（主管比較易讀）
    const header = [
      ["停靠點代碼", "停靠點名稱", "停靠點地址",
       "縣市", "行政區",
       "緯度", "經度",
       "可配送時窗起", "可配送時窗迄",
       "平均停留分鐘數", "平均貨量(箱)",
       "溫層(frozen/chilled/mixed/ambient)",
       "班別(day/night)",
       "特殊車輛需求",
       "聯絡人", "聯絡電話", "備註"]
    ];
    const body = (data ?? []).map((r) => [
      r.external_code ?? "",
      r.name,
      r.address,
      r.city ?? "",
      r.district ?? "",
      r.lat ?? "",
      r.lng ?? "",
      r.time_window_start ?? "",
      r.time_window_end ?? "",
      r.default_service_minutes ?? 10,
      r.avg_delivery_volume ?? "",
      r.temperature_type ?? "",
      r.shift ?? "",
      r.special_vehicle_requirement ?? "",
      r.contact_name ?? "",
      r.contact_phone ?? "",
      r.notes ?? ""
    ]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([...header, ...body]);
    // 欄寬
    ws["!cols"] = [
      { wch: 14 }, { wch: 24 }, { wch: 34 }, { wch: 10 }, { wch: 12 },
      { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 },
      { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 14 },
      { wch: 18 }, { wch: 12 }, { wch: 16 }, { wch: 30 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, "停靠點主檔");

    const arrBuf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const filename = `stops_${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new Response(arrBuf, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`
      }
    });
  } catch (e) {
    return handleApiError(e);
  }
}

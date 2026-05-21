import * as XLSX from "xlsx";
import { requireManager } from "@/lib/auth/server-auth";
import { handleApiError } from "@/lib/api/response";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/manager/drivers/export
 *   下載目前所有物流士 xlsx（中文標頭）。主管可在 Excel 編輯後再用 import 灌回。
 */
export async function GET() {
  try {
    await requireManager();
    const admin = createSupabaseAdminClient();

    interface Row {
      id: string;
      employee_code: string | null;
      full_name: string;
      phone: string | null;
      shift: string | null;
      max_work_minutes: number | null;
      vehicle_id: string | null;
      vehicle_type: string | null;
      vehicle_capacity: number | null;
      temperature_capability: string | null;
      is_active: boolean;
    }
    const { data, error } = await admin
      .from("profiles")
      .select(
        "id, employee_code, full_name, phone, shift, max_work_minutes, " +
          "vehicle_id, vehicle_type, vehicle_capacity, temperature_capability, is_active"
      )
      .eq("role", "driver")
      .order("employee_code", { ascending: true })
      .returns<Row[]>();
    if (error) throw error;

    // 用 admin auth API 同步抓 email
    const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const emailById = new Map<string, string>();
    for (const u of usersPage?.users ?? []) {
      if (u.email) emailById.set(u.id, u.email);
    }

    const header = [
      ["員編", "姓名", "Email", "電話",
       "班別(day/night)", "工時上限(分鐘)",
       "車輛代號", "車輛類型",
       "車輛容量(箱)",
       "溫層能力(frozen/chilled/mixed/ambient)",
       "啟用(true/false)"]
    ];
    const body = (data ?? []).map((r) => [
      r.employee_code ?? "",
      r.full_name,
      emailById.get(r.id) ?? "",
      r.phone ?? "",
      r.shift ?? "",
      r.max_work_minutes ?? 480,
      r.vehicle_id ?? "",
      r.vehicle_type ?? "",
      r.vehicle_capacity ?? "",
      r.temperature_capability ?? "",
      r.is_active ? "true" : "false"
    ]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([...header, ...body]);
    ws["!cols"] = [
      { wch: 10 }, { wch: 14 }, { wch: 26 }, { wch: 14 },
      { wch: 14 }, { wch: 12 },
      { wch: 12 }, { wch: 16 },
      { wch: 12 }, { wch: 24 },
      { wch: 8 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, "物流士主檔");

    const arrBuf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const filename = `drivers_${new Date().toISOString().slice(0, 10)}.xlsx`;
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

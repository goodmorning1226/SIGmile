import { PageHeader } from "@/components/layout/PageHeader";
import { getDriversOverview } from "@/lib/services/driver-overview-service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { DriverGrid } from "./DriverGrid";
import { CreateDriverDialog } from "./CreateDriverDialog";
import { DriversExcelPanel } from "./DriversExcelPanel";

export const dynamic = "force-dynamic";

export default async function DriversPage() {
  const rows = await getDriversOverview();
  const withTask = rows.filter((r) => r.task_status !== "idle").length;
  const inProgress = rows.filter((r) => r.task_status === "in_progress").length;
  const exceptions = rows.reduce((sum, r) => sum + r.exceptions, 0);

  // 主檔總人數（包含今天沒任務的）
  const admin = createSupabaseAdminClient();
  const { count: driverCount } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "driver")
    .eq("is_active", true);

  return (
    <>
      <PageHeader
        title="物流士"
        description={
          (driverCount ?? 0) === 0
            ? "尚未建立任何物流士。按右上「新增物流士」開始。"
            : `啟用中 ${driverCount ?? 0} 位 · 今日派送 ${withTask} 位 · 進行中 ${inProgress} 位 · ${exceptions} 件異常`
        }
        actions={<CreateDriverDialog />}
      />

      <DriversExcelPanel driverCount={driverCount ?? 0} />

      <DriverGrid rows={rows} />
    </>
  );
}

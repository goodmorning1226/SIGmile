import { Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
          rows.length === 0
            ? "尚未建立任何物流士。按右上「新增物流士」開始。"
            : `啟用中 ${rows.length} 位 · 今日派送 ${withTask} 位 · 進行中 ${inProgress} 位 · ${exceptions} 件異常`
        }
        actions={<CreateDriverDialog />}
      />

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="size-4 text-brand-500" />
            <CardTitle>物流士主檔</CardTitle>
          </div>
          <CardDescription>
            目前共 <strong className="text-slate-900">{driverCount ?? 0}</strong> 位啟用中的物流士。
            OR 試算時會自動使用所有啟用中的物流士去分配路線，<strong>不用再寫 SQL</strong>。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DriversExcelPanel />
        </CardContent>
      </Card>

      <DriverGrid rows={rows} />
    </>
  );
}

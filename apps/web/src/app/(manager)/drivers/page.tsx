import { PageHeader } from "@/components/layout/PageHeader";
import { getDriversOverview } from "@/lib/services/driver-overview-service";
import { DriverGrid } from "./DriverGrid";

export const dynamic = "force-dynamic";

export default async function DriversPage() {
  const rows = await getDriversOverview();
  const inProgress = rows.filter((r) => r.task_status === "in_progress").length;
  const exceptions = rows.reduce((sum, r) => sum + r.exceptions, 0);

  return (
    <>
      <PageHeader
        title="物流士"
        description={
          rows.length === 0
            ? "今日尚無派送任務"
            : `今日共 ${rows.length} 位物流士派送中 · ${inProgress} 位進行中 · ${exceptions} 件異常`
        }
      />

      <DriverGrid rows={rows} />
    </>
  );
}

import { PageHeader } from "@/components/layout/PageHeader";
import { EmergencyBoard } from "./EmergencyBoard";

export const dynamic = "force-dynamic";

export default function EmergencyPage() {
  return (
    <>
      <PageHeader
        title="緊急應變"
        description="物流士臨時翹班 / 出事故 / 車輛拋錨時，逐一挑選誰要接這些 pending 站。"
      />

      <EmergencyBoard />
    </>
  );
}

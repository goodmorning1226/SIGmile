import { PageHeader } from "@/components/layout/PageHeader";
import { UrgentBoard } from "./UrgentBoard";

export const dynamic = "force-dynamic";

export default function UrgentPage() {
  return (
    <>
      <PageHeader
        title="急件派遣"
        description="臨時加單 / VIP 急件 / API 推來的緊急配送，由 AI 給主管排序候選物流士，主管按一鍵派遣。"
      />

      <UrgentBoard />
    </>
  );
}

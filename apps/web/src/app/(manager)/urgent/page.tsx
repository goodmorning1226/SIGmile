import { Zap } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { UrgentBoard } from "./UrgentBoard";

export const dynamic = "force-dynamic";

export default function UrgentPage() {
  return (
    <>
      <PageHeader
        title="急件派遣"
        description="臨時加單 / VIP 急件 / API 推來的緊急配送，由 AI 給主管排序候選物流士，主管按一鍵派遣。"
      />

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Zap className="size-4 text-amber-500" />
            <CardTitle>運作方式</CardTitle>
          </div>
          <CardDescription>
            <ol className="mt-1 list-decimal pl-5 space-y-0.5">
              <li>「產生 Mock 急件」會從 stops 主檔抽 5 個點，模擬從客服/業務/API 進來的急件（in-memory，重啟 server 會清空）</li>
              <li>對每筆急件按「AI 派遣建議」→ 系統用距離 / 容量 / 班別 / 溫層 / pending 載量 / 優先級 6 維度給候選物流士排名</li>
              <li>選定後按「確認派遣」→ 把急件當第 N 站附加到該 driver 今日 delivery_task</li>
            </ol>
          </CardDescription>
        </CardHeader>
      </Card>

      <UrgentBoard />
    </>
  );
}

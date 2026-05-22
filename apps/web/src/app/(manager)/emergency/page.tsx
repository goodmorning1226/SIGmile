import { LifeBuoy } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmergencyBoard } from "./EmergencyBoard";

export const dynamic = "force-dynamic";

export default function EmergencyPage() {
  return (
    <>
      <PageHeader
        title="緊急應變"
        description="物流士臨時翹班 / 出事故 / 車輛拋錨時，AI 自動把 pending 站重派給其他物流士，主管 1 鍵確認即生效。"
      />

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <LifeBuoy className="size-4 text-red-500" />
            <CardTitle>運作方式</CardTitle>
          </div>
          <CardDescription>
            <ol className="mt-1 list-decimal pl-5 space-y-0.5">
              <li>下方列出今日所有物流士進度（pending / completed）</li>
              <li>對需要緊急應變的物流士按「標記翹班 / 應變」→ AI 用 cheapest-insertion 把該人 pending stops 分到其他人</li>
              <li>主管預覽方案、確認 → 寫進 delivery_task_stops（搬遷 task_id + reset 狀態 pending）</li>
              <li>原本那位物流士的 delivery_task 狀態改成 cancelled</li>
            </ol>
          </CardDescription>
        </CardHeader>
      </Card>

      <EmergencyBoard />
    </>
  );
}

import { MessageSquare } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AssistantChat } from "./AssistantChat";

export const dynamic = "force-dynamic";

export default function AssistantPage() {
  return (
    <>
      <PageHeader
        title="AI 助理"
        description="用人話描述情況 → AI 解讀 → 給出可一鍵執行的行動卡。緊急應變 / 急件 / 延誤 / 客訴都可以問。"
      />

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <MessageSquare className="size-4 text-brand-500" />
            <CardTitle>怎麼用</CardTitle>
          </div>
          <CardDescription>
            主管不用記哪個按鈕在哪頁 — 直接用人話描述情況，AI 會解讀後給你
            「可一鍵執行的行動卡」。例如：「D02 突然請假，剩 12 站怎麼辦」、
            「下午突然下雨，車隊進度落後 30 分」、「VIP 客戶剛打來說要加 3 件」。
            所有行動都會接到本系統已有的 API（緊急應變 / 急件派遣 / AI 分析）。
          </CardDescription>
        </CardHeader>
      </Card>

      <AssistantChat />
    </>
  );
}

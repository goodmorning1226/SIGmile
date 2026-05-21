import { Sparkles, History, MessageSquare } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InsightsClient } from "./InsightsClient";

export const dynamic = "force-dynamic";

export default function InsightsPage() {
  return (
    <>
      <PageHeader
        title="AI 深度分析"
        description="比 dashboard 更深一層：找出時段瓶頸、物流士 outlier、門市異常熱點、可直接行動的建議。"
        actions={
          <div className="flex gap-2">
            <Link href="/ai-assistant">
              <Button>
                <MessageSquare className="size-4" />
                問 AI 助理
              </Button>
            </Link>
            <Link href="/ai-analysis">
              <Button variant="outline">
                <History className="size-4" />
                歷史紀錄
              </Button>
            </Link>
          </div>
        }
      />

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-brand-500" />
            <CardTitle>關於 AI 深度分析</CardTitle>
          </div>
          <CardDescription>
            系統會結合「今日資料 + 過去 7 天歷史」算出 6 個維度的洞察：
            整體 KPI 對比、時段瓶頸偵測（哪小時崩盤）、物流士 z-score outlier、
            門市異常熱點、延誤路線、可執行下一步。
            按下方按鈕即時刷新（不寫死任何 demo 資料）。
          </CardDescription>
        </CardHeader>
      </Card>

      <InsightsClient />
    </>
  );
}

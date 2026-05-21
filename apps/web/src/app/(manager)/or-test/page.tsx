import { Beaker } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { OrTestRunner } from "./OrTestRunner";

export const dynamic = "force-dynamic";

export default function OrTestPage() {
  return (
    <>
      <PageHeader
        title="OR 演算法測試"
        description="純 TS 演算法（Sweep / NN / VRPTW / Hungarian / Cheapest-Insertion）的視覺化驗證 — 不用 Python 也不用 DB。"
      />

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Beaker className="size-4 text-brand-500" />
            <CardTitle>為什麼有這頁</CardTitle>
          </div>
          <CardDescription>
            OR engine 上線前，先確認核心啟發式的 (a) 輸出符合容量/時間窗約束、
            (b) 路線總長隨站數合理成長、(c) 不同演算法在同樣 input 下產出有差異。
            這頁可以在瀏覽器一鍵跑（不需要任何後端／資料庫）。
          </CardDescription>
        </CardHeader>
      </Card>

      <OrTestRunner />
    </>
  );
}

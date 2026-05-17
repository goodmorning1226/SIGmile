"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RunAnalysisButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = () => {
    startTransition(async () => {
      const res = await fetch("/api/manager/ai-analysis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "today_overview" })
      });
      const j = await res.json();
      if (!j.ok) {
        alert(j.error?.message ?? "分析失敗");
        return;
      }
      router.refresh();
    });
  };

  return (
    <Button onClick={run} loading={pending}>
      <Sparkles className="size-4" />
      產生新分析
    </Button>
  );
}

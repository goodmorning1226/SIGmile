"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AiAnalysisResult } from "@/types/domain";

interface Props { context: Record<string, number>; }

export function AiAnalysisButton({ context }: Props) {
  const [open, setOpen]       = useState(false);
  const [result, setResult]   = useState<AiAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const run = async () => {
    setLoading(true); setError(null); setResult(null); setOpen(true);
    try {
      const res = await fetch("/api/manager/ai-analysis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "today_overview", context })
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message ?? "AI 分析失敗");
      setResult(json.data.analysis as AiAnalysisResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI 分析失敗");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button onClick={run} loading={loading}>
        <Sparkles className="h-4 w-4" />
        AI 分析目前配送狀況
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm grid place-items-start overflow-y-auto p-6">
          <div className="w-full max-w-2xl mx-auto mt-12">
            <Card>
              <CardHeader className="flex items-center justify-between flex-row">
                <CardTitle>AI 配送狀況分析</CardTitle>
                <button
                  onClick={() => setOpen(false)}
                  className="text-slate-400 hover:text-slate-700 text-sm"
                >關閉</button>
              </CardHeader>
              <CardContent>
                {loading && <p className="text-sm text-slate-500">分析中…</p>}
                {error && (
                  <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                )}
                {result && (
                  <div className="space-y-4 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">風險等級：</span>
                      <Badge tone={result.risk_level === "high" ? "danger" : result.risk_level === "medium" ? "warning" : "success"}>
                        {result.risk_level.toUpperCase()}
                      </Badge>
                      <span className="ml-auto text-xs text-slate-400">
                        {new Date(result.generated_at).toLocaleString("zh-TW")}
                      </span>
                    </div>

                    <p className="leading-relaxed text-slate-800">{result.summary}</p>

                    <div>
                      <div className="mb-2 text-xs font-semibold text-slate-500">延誤路線</div>
                      {result.delayed_routes.length === 0 ? (
                        <p className="text-slate-500 text-sm">無</p>
                      ) : (
                        <ul className="space-y-1">
                          {result.delayed_routes.map((r, i) => (
                            <li key={i} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                              <span className="font-medium">{r.driver_name}</span>
                              <span className="text-slate-500"> · {r.route_name}</span>
                              <span className="ml-2 text-amber-700">延誤 {r.estimated_delay_minutes} 分鐘</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div>
                      <div className="mb-2 text-xs font-semibold text-slate-500">建議處理方式</div>
                      <ul className="list-disc list-inside space-y-1 text-slate-700">
                        {result.recommended_actions.map((a, i) => <li key={i}>{a}</li>)}
                      </ul>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

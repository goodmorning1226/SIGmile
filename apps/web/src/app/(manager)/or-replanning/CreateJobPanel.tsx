"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OrInputForm, DEFAULT_OR_INPUT, type OrInputParams } from "./OrInputForm";

interface Props {
  periodId: string;
  periodLabel: string;
}

export function CreateJobPanel({ periodId, periodLabel }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [params, setParams] = useState<OrInputParams>(DEFAULT_OR_INPUT);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const res = await fetch("/api/manager/or-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planning_period_id: periodId, input_parameters: params })
      });
      const j = await res.json();
      if (!j.ok) {
        alert(j.error?.message ?? "建立失敗");
        return;
      }
      setOpen(false);
      setParams(DEFAULT_OR_INPUT);
      router.refresh();
    });
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        建立新規劃任務
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-start overflow-y-auto bg-slate-900/40 p-6 backdrop-blur-sm">
          <Card className="mx-auto mt-12 w-full max-w-2xl">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle>建立新規劃任務</CardTitle>
                  <p className="mt-1 text-xs text-slate-500">{periodLabel}</p>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="text-slate-400 hover:text-slate-700"
                >
                  <X className="size-5" />
                </button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-slate-500">
                以下參數會用來規劃這個期間每位物流士的路線分配與順序。建立後可立即試算。
              </p>
              <OrInputForm value={params} onChange={setParams} />

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
                <Button onClick={submit} loading={pending}>
                  建立任務
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

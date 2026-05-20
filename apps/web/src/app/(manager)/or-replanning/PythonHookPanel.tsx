import { Code2, ExternalLink } from "lucide-react";

/**
 * 「Python OR engine 接點」說明區。
 *   目前 mock 模擬 OR 結果；真實 Python solver（OR-Tools / Pyomo）接上後只要改一個檔。
 */
export function PythonHookPanel() {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
      <div className="flex items-start gap-2">
        <Code2 className="mt-0.5 size-4 shrink-0 text-slate-500" />
        <div className="flex-1 space-y-2 text-sm text-slate-700">
          <div className="font-semibold text-slate-900">
            Python OR engine 接點（之後串接）
          </div>
          <p className="text-xs">
            目前「試算」按鈕走 mock 路徑（依班別 / 區域 / 容量自動分群）。
            等實作好的 Python OR engine（OR-Tools / Pyomo）拿到後，
            只需要在以下檔案把 <code className="rounded bg-white px-1 py-0.5 text-[11px] text-slate-800">runMockPlanningJob</code>
            換成呼叫真實 solver 的版本：
          </p>
          <ul className="list-disc pl-5 text-xs space-y-1">
            <li>
              <code className="rounded bg-white px-1 py-0.5 text-[11px]">apps/web/src/lib/services/or-planning-service.ts</code>
              {" "}— 新增 <code className="rounded bg-white px-1 py-0.5 text-[11px]">PythonORPlanningService implements IORPlanningService</code>，
              透過 fetch 呼叫 Supabase Edge Function（或自架 HTTP service）即可。
            </li>
            <li>
              輸出必須符合 <code className="rounded bg-white px-1 py-0.5 text-[11px]">OrOutputPlanV2</code> schema
              （見 <code className="rounded bg-white px-1 py-0.5 text-[11px]">apps/web/src/types/domain.ts</code>）。
              其餘前後端不用改。
            </li>
            <li>
              Edge Function 樣板路徑：
              <code className="ml-1 rounded bg-white px-1 py-0.5 text-[11px]">
                supabase/functions/or-solver/index.ts
              </code>
              （之後接到時建立）
            </li>
          </ul>
          <a
            href="https://supabase.com/docs/guides/functions"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
          >
            Supabase Edge Functions 文件 <ExternalLink className="size-3" />
          </a>
        </div>
      </div>
    </div>
  );
}

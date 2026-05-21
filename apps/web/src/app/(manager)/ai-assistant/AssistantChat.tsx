"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Send, Sparkles, User, Loader2, AlertTriangle,
  CheckCircle2, ArrowRight, RotateCcw, Wand2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const QUICK_SCENARIOS = [
  { emoji: "🚨", label: "物流士翹班", template: "D02 突然不能跑了，他剩 12 站怎麼辦？" },
  { emoji: "⚡", label: "VIP 急件",   template: "VIP 客戶剛打電話來，有 3 件急件需要今天送到" },
  { emoji: "🌧️", label: "突發塞車", template: "下午下雨大塞車，車隊進度落後 30 分，怎麼追？" },
  { emoji: "❄️", label: "冷凍異常",   template: "有 1 個客戶反映凍品融化了，怎麼處理？" },
  { emoji: "📊", label: "現況查詢",   template: "現在配送狀況怎麼樣？哪些路線有問題？" },
  { emoji: "🤔", label: "假設推演",   template: "假設明天有 2 個物流士請假，我們撐得住嗎？" }
];

interface ActionCard {
  action_type: string;
  title: string;
  description: string;
  confidence: number;
  impact_preview: string;
  payload?: Record<string, unknown>;
  priority: "p0" | "p1" | "p2";
  cta_label: string;
}

interface AssistantReply {
  interpretation: string;
  intent: string;
  slots: Record<string, string | number | undefined>;
  actions: ActionCard[];
  notes: string[];
  confidence: number;
}

interface Turn {
  role: "user" | "assistant" | "execution";
  text: string;
  reply?: AssistantReply;
  execution?: {
    title: string;
    ok: boolean;
    message: string;
    redirect_to?: string;
    detail?: unknown;
  };
}

const INTENT_LABEL: Record<string, { label: string; tone: "danger" | "warning" | "info" | "success" | "neutral" }> = {
  driver_down:       { label: "物流士無法配送", tone: "danger" },
  urgent_order:      { label: "急件 / 加單",     tone: "warning" },
  delay_recovery:    { label: "延誤應變",        tone: "warning" },
  quality_issue:     { label: "客訴 / 品質",     tone: "warning" },
  status_query:      { label: "現況查詢",        tone: "info" },
  scenario_planning: { label: "假設推演",        tone: "info" },
  general_help:      { label: "通用幫助",        tone: "neutral" }
};

const PRIO_TONE: Record<"p0" | "p1" | "p2", "danger" | "warning" | "info"> = {
  p0: "danger", p1: "warning", p2: "info"
};

export function AssistantChat() {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const [executingKey, setExecutingKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, pending]);

  const ask = (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg) return;
    setInput("");
    setTurns((t) => [...t, { role: "user", text: msg }]);
    startTransition(async () => {
      try {
        const res = await fetch("/api/manager/ai-assistant/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: msg })
        });
        const j = await res.json();
        if (!j.ok) {
          setTurns((t) => [...t, {
            role: "assistant",
            text: `AI 請求失敗：${j.error?.message ?? "unknown"}`
          }]);
          return;
        }
        const reply = j.data.reply as AssistantReply;
        setTurns((t) => [...t, {
          role: "assistant",
          text: reply.interpretation,
          reply
        }]);
      } catch (e) {
        setTurns((t) => [...t, {
          role: "assistant",
          text: `網路錯誤：${e instanceof Error ? e.message : "unknown"}`
        }]);
      }
    });
  };

  const execute = async (turnIdx: number, action: ActionCard) => {
    const key = `${turnIdx}-${action.action_type}`;
    setExecutingKey(key);
    try {
      const res = await fetch("/api/manager/ai-assistant/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action_type: action.action_type, payload: action.payload ?? {} })
      });
      const j = await res.json();
      const exec = j.ok ? j.data : { ok: false, message: j.error?.message ?? "執行失敗" };
      setTurns((t) => [...t, {
        role: "execution",
        text: `[執行] ${action.title}`,
        execution: {
          title: action.title,
          ok: exec.ok,
          message: exec.message,
          redirect_to: exec.redirect_to,
          detail: exec.detail
        }
      }]);
    } catch (e) {
      setTurns((t) => [...t, {
        role: "execution",
        text: `[執行] ${action.title}`,
        execution: {
          title: action.title,
          ok: false,
          message: e instanceof Error ? e.message : "未知錯誤"
        }
      }]);
    } finally {
      setExecutingKey(null);
    }
  };

  const clearChat = () => setTurns([]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
      {/* Sidebar: quick scenarios + clear */}
      <div className="space-y-3">
        <Card>
          <CardContent className="p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              <Wand2 className="size-3.5 text-brand-500" />
              快速場景
            </div>
            <div className="space-y-1">
              {QUICK_SCENARIOS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  disabled={pending}
                  onClick={() => ask(s.template)}
                  className="flex w-full items-start gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left text-xs hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50"
                >
                  <span className="text-base leading-none">{s.emoji}</span>
                  <span className="min-w-0">
                    <span className="block font-medium text-slate-800">{s.label}</span>
                    <span className="block text-[10px] text-slate-500 line-clamp-2">{s.template}</span>
                  </span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {turns.length > 0 && (
          <Button variant="outline" size="sm" className="w-full" onClick={clearChat}>
            <RotateCcw className="size-3.5" /> 清空對話
          </Button>
        )}
      </div>

      {/* Main chat */}
      <Card>
        <CardContent className="flex h-[680px] flex-col p-0">
          {/* messages */}
          <div className="flex-1 overflow-y-auto p-5">
            {turns.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <Sparkles className="size-10 text-brand-300" />
                <div className="mt-3 text-sm font-medium text-slate-700">
                  用人話描述目前的情況
                </div>
                <div className="mt-1 max-w-sm text-xs text-slate-500">
                  例：「D02 突然不能跑了，他剩 12 站怎麼辦？」
                  AI 會解讀後給你可一鍵執行的行動卡。
                </div>
              </div>
            ) : (
              <ul className="space-y-4">
                {turns.map((t, i) => (
                  <li key={i} className="">
                    {t.role === "user" ? (
                      <UserBubble text={t.text} />
                    ) : t.role === "assistant" ? (
                      <AssistantBubble
                        text={t.text}
                        reply={t.reply}
                        onExecute={(action) => execute(i, action)}
                        executingKey={executingKey}
                        turnIdx={i}
                      />
                    ) : t.execution ? (
                      <ExecutionBubble exec={t.execution} onNavigate={(p) => router.push(p)} />
                    ) : null}
                  </li>
                ))}
                {pending && <li><LoadingBubble /></li>}
              </ul>
            )}
            <div ref={bottomRef} />
          </div>

          {/* composer */}
          <div className="border-t border-slate-100 p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!pending && input.trim()) ask();
                  }
                }}
                placeholder="例：D02 翹班了，剩 8 站怎麼辦？(Enter 送出，Shift+Enter 換行)"
                rows={2}
                disabled={pending}
                className="flex-1 resize-none rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-50"
              />
              <Button onClick={() => ask()} loading={pending} disabled={!input.trim()}>
                <Send className="size-4" />
                送出
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end gap-2">
      <div className="max-w-[78%] rounded-2xl rounded-br-sm bg-brand-600 px-4 py-2 text-sm text-white">
        {text}
      </div>
      <div className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-700">
        <User className="size-4" />
      </div>
    </div>
  );
}

function LoadingBubble() {
  return (
    <div className="flex justify-start gap-2">
      <div className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-100">
        <Sparkles className="size-4 animate-pulse text-brand-500" />
      </div>
      <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-2 text-sm text-slate-600">
        <Loader2 className="mr-1 inline-block size-3 animate-spin" />
        AI 思考中…
      </div>
    </div>
  );
}

function AssistantBubble({
  text, reply, onExecute, executingKey, turnIdx
}: {
  text: string;
  reply?: AssistantReply;
  onExecute: (a: ActionCard) => void;
  executingKey: string | null;
  turnIdx: number;
}) {
  const intentMeta = reply?.intent ? INTENT_LABEL[reply.intent] : null;
  return (
    <div className="flex justify-start gap-2">
      <div className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-100">
        <Sparkles className="size-4 text-brand-600" />
      </div>
      <div className="min-w-0 max-w-[88%] flex-1">
        {/* interpretation */}
        <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-2.5">
          {intentMeta && (
            <div className="mb-1.5 flex items-center gap-1.5">
              <Badge tone={intentMeta.tone}>{intentMeta.label}</Badge>
              {reply && (
                <span className="text-[10px] text-slate-500">
                  信心 {(reply.confidence * 100).toFixed(0)}%
                </span>
              )}
            </div>
          )}
          <p className="text-sm leading-relaxed text-slate-800">{text}</p>
          {reply?.slots && Object.values(reply.slots).some((v) => v !== undefined && v !== null) && (
            <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
              {Object.entries(reply.slots)
                .filter(([, v]) => v !== undefined && v !== null && v !== "")
                .map(([k, v]) => (
                  <span key={k} className="rounded-full bg-white px-2 py-0.5 font-mono text-slate-600 ring-1 ring-slate-200">
                    {k}={String(v)}
                  </span>
                ))}
            </div>
          )}
          {reply?.notes && reply.notes.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[11px] text-amber-700">
              {reply.notes.map((n, i) => (
                <li key={i}>⚠️ {n}</li>
              ))}
            </ul>
          )}
        </div>

        {/* action cards */}
        {reply?.actions && reply.actions.length > 0 && (
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            {reply.actions.map((a) => {
              const key = `${turnIdx}-${a.action_type}`;
              return (
                <div
                  key={a.action_type + a.title}
                  className="flex flex-col rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:border-brand-300"
                >
                  <div className="mb-1 flex items-center gap-1.5">
                    <Badge tone={PRIO_TONE[a.priority]}>{a.priority.toUpperCase()}</Badge>
                    <span className="text-[10px] text-slate-500">信心 {(a.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <div className="text-sm font-semibold text-slate-900">{a.title}</div>
                  <div className="mt-1 whitespace-pre-line text-xs text-slate-600">{a.description}</div>
                  <div className="mt-2 text-[10px] text-slate-400">影響：{a.impact_preview}</div>
                  <div className="mt-auto pt-2.5">
                    <Button
                      size="sm"
                      className="w-full"
                      variant={a.priority === "p0" ? "primary" : a.priority === "p1" ? "primary" : "outline"}
                      loading={executingKey === key}
                      disabled={a.action_type === "no_op_explain"}
                      onClick={() => onExecute(a)}
                    >
                      {a.cta_label}
                      <ArrowRight className="size-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ExecutionBubble({
  exec, onNavigate
}: { exec: NonNullable<Turn["execution"]>; onNavigate: (path: string) => void }) {
  return (
    <div className="flex justify-start gap-2">
      <div className={
        "grid size-7 shrink-0 place-items-center rounded-full " +
        (exec.ok ? "bg-accent-100" : "bg-red-100")
      }>
        {exec.ok ? (
          <CheckCircle2 className="size-4 text-accent-600" />
        ) : (
          <AlertTriangle className="size-4 text-red-600" />
        )}
      </div>
      <div className="max-w-[88%] flex-1">
        <div className={
          "rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm " +
          (exec.ok
            ? "border border-accent-200 bg-accent-50 text-accent-900"
            : "border border-red-200 bg-red-50 text-red-900")
        }>
          <div className="text-xs font-semibold uppercase tracking-wider opacity-70">
            {exec.ok ? "✓ 已執行" : "✗ 執行失敗"}
          </div>
          <div className="mt-1 font-medium">{exec.title}</div>
          <div className="mt-1 whitespace-pre-line text-xs">{exec.message}</div>
          {Boolean(exec.detail) && typeof exec.detail === "object" && (
            <details className="mt-2 text-[10px]">
              <summary className="cursor-pointer text-slate-500 hover:text-slate-700">
                檢視執行細節 (JSON)
              </summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-white/60 p-2 font-mono text-[10px]">
                {JSON.stringify(exec.detail, null, 2)}
              </pre>
            </details>
          )}
          {exec.redirect_to && (
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={() => onNavigate(exec.redirect_to!)}>
                <ArrowRight className="size-3.5" />
                前往 {exec.redirect_to}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileEdit, CheckCircle2, Send, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

export type PlanTabKey = "drafts" | "published";

export interface PlanItem {
  id: string;
  version: number;
  status: string;            // 'draft' | 'published' | 'archived'
  notes: string | null;
}

interface Props {
  /** 此頁的 base path，例如 "/clusters" 或 "/assignment" */
  basePath: string;
  plans: PlanItem[];
  activeTab: PlanTabKey;
  activePlanId: string | null;
}

/**
 * 切換「草稿 / 已發布」tab + 顯示該 tab 內所有可選版本。
 * URL 模式：`{basePath}?tab=drafts|published&plan=<id>`
 *
 * UX：用 useTransition + router.push（不是 Link）→ 切換時：
 *   - 立刻 highlight 被點的目標（optimistic）
 *   - 顯示 spinner 讓使用者知道在 loading
 *   - 過渡期間整個編輯區會被 isPending wrapper 半透明化
 */
export function PlanTabsSelector({
  basePath, plans, activeTab, activePlanId
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimisticTab, setOptimisticTab] = useState<PlanTabKey>(activeTab);
  const [optimisticPlanId, setOptimisticPlanId] = useState<string | null>(activePlanId);

  // 如果 server 回來的 props 跟 optimistic 不同（例如使用者按瀏覽器上一頁），同步回來
  if (optimisticTab !== activeTab) setOptimisticTab(activeTab);
  if (optimisticPlanId !== activePlanId) setOptimisticPlanId(activePlanId);

  const drafts    = plans.filter((p) => p.status === "draft");
  const published = plans.filter((p) => p.status === "published");
  const visible   = optimisticTab === "drafts" ? drafts : published;

  const switchTab = (tab: PlanTabKey) => {
    if (tab === optimisticTab) return;
    setOptimisticTab(tab);
    // 切 tab 時清掉選定的 plan（讓 server 自動選該 tab 第一筆）
    setOptimisticPlanId(null);
    startTransition(() => {
      router.push(`${basePath}?tab=${tab}`, { scroll: false });
    });
  };

  const switchPlan = (planId: string) => {
    if (planId === optimisticPlanId) return;
    setOptimisticPlanId(planId);
    startTransition(() => {
      router.push(`${basePath}?tab=${optimisticTab}&plan=${planId}`, { scroll: false });
    });
  };

  return (
    <div className="space-y-3">
      {/* tab 列 */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        <TabButton
          onClick={() => switchTab("drafts")}
          active={optimisticTab === "drafts"}
          loading={isPending && optimisticTab === "drafts" && activeTab !== "drafts"}
          icon={<FileEdit className="size-4" />}
          label="草稿"
          count={drafts.length}
          tone="amber"
        />
        <TabButton
          onClick={() => switchTab("published")}
          active={optimisticTab === "published"}
          loading={isPending && optimisticTab === "published" && activeTab !== "published"}
          icon={<CheckCircle2 className="size-4" />}
          label="已發布"
          count={published.length}
          tone="accent"
        />
        {isPending && (
          <span className="ml-auto inline-flex items-center gap-1.5 px-2 text-xs text-slate-500">
            <Loader2 className="size-3.5 animate-spin" />
            載入中…
          </span>
        )}
      </div>

      {/* 版本 chips */}
      {visible.length === 0 ? (
        <p className="text-sm text-slate-500">
          {optimisticTab === "drafts"
            ? "目前沒有草稿。請至「發布新路線」跑一次規劃產生新草稿。"
            : "目前沒有任何已發布版本。"}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {visible.map((p) => {
            const isActive = p.id === optimisticPlanId;
            const isPublished = p.status === "published";
            const isSwitching = isPending && isActive && p.id !== activePlanId;
            return (
              <button
                key={p.id}
                onClick={() => switchPlan(p.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition",
                  isActive
                    ? isPublished
                      ? "border-accent-500 bg-accent-50 text-accent-700 font-medium"
                      : "border-amber-500 bg-amber-50 text-amber-800 font-medium"
                    : "border-slate-200 bg-white text-slate-700 hover:border-brand-300"
                )}
              >
                第 {p.version} 版
                {p.notes && <span className="text-xs text-slate-400">· {p.notes}</span>}
                {isSwitching && <Loader2 className="size-3 animate-spin" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TabButton({
  onClick, active, loading, icon, label, count, tone
}: {
  onClick: () => void;
  active: boolean;
  loading: boolean;
  icon: React.ReactNode;
  label: string;
  count: number;
  tone: "amber" | "accent";
}) {
  const toneClass =
    active
      ? tone === "amber"
        ? "border-amber-500 text-amber-700"
        : "border-accent-600 text-accent-700"
      : "border-transparent text-slate-500 hover:text-slate-700";

  return (
    <button
      onClick={onClick}
      type="button"
      className={cn(
        "-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition",
        toneClass
      )}
    >
      {icon}
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
          active
            ? tone === "amber"
              ? "bg-amber-100 text-amber-700"
              : "bg-accent-100 text-accent-700"
            : "bg-slate-100 text-slate-600"
        )}
      >
        {count}
      </span>
      {loading && <Loader2 className="size-3 animate-spin text-slate-400" />}
    </button>
  );
}

/** 已發布版本的唯讀提示橫條，放在編輯器上方 */
export function PublishedReadOnlyBanner() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-accent-300 bg-accent-50 p-3 text-sm">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent-600" />
      <div className="space-y-0.5 text-accent-800">
        <div className="font-semibold">此版本已發布 · 唯讀檢視</div>
        <div className="text-xs">
          要修改路線，請至「發布新路線」建立新草稿、編輯完後再發布。
        </div>
      </div>
    </div>
  );
}

/**
 * 草稿可發布橫條：顯示「這是草稿，按右側按鈕即可發布」。
 * 發布後此期間舊版本會自動 archived（API 端 publishPlan 已處理）。
 */
export function DraftPublishBanner({ planId, version }: { planId: string; version: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const publish = () => {
    if (!confirm(
      `確定要發布「第 ${version} 版」嗎？\n\n` +
      "發布後：\n" +
      "  • 同期間舊的已發布版本會自動封存\n" +
      "  • 物流士 App 會看到新版任務\n" +
      "  • 此後此草稿變為唯讀"
    )) return;
    startTransition(async () => {
      const res = await fetch(`/api/manager/route-plans/${planId}/publish`, {
        method: "POST"
      });
      const j = await res.json();
      if (!j.ok) {
        alert(j.error?.message ?? "發布失敗");
        return;
      }
      const n = j.data?.tasksCreated ?? 0;
      alert(
        `✅ 已發布第 ${version} 版\n\n` +
        `自動建立 ${n} 個物流士的今日任務。\n` +
        (n === 0
          ? "（注意：所有路線集都沒指派 driver，請到「物流士分配」補。）"
          : "可到「物流士」頁查看派送狀態。")
      );
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div className="space-y-0.5 text-amber-900">
          <div className="font-semibold">第 {version} 版 · 草稿狀態</div>
          <div className="text-xs">
            可在此頁編輯。確認沒問題後按右側「發布」立即上線；舊版會自動封存。
          </div>
        </div>
      </div>
      <Button
        variant="success"
        size="sm"
        onClick={publish}
        loading={pending}
      >
        <Send className="size-3.5" />
        發布此草稿
      </Button>
    </div>
  );
}

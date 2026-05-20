import Link from "next/link";
import { FileEdit, CheckCircle2 } from "lucide-react";
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
 */
export function PlanTabsSelector({
  basePath, plans, activeTab, activePlanId
}: Props) {
  const drafts    = plans.filter((p) => p.status === "draft");
  const published = plans.filter((p) => p.status === "published");

  const visible = activeTab === "drafts" ? drafts : published;

  const tabHref = (tab: PlanTabKey) => `${basePath}?tab=${tab}`;
  const planHref = (planId: string) => `${basePath}?tab=${activeTab}&plan=${planId}`;

  return (
    <div className="space-y-3">
      {/* tab 列 */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        <TabButton
          href={tabHref("drafts")}
          active={activeTab === "drafts"}
          icon={<FileEdit className="size-4" />}
          label="草稿"
          count={drafts.length}
          tone="amber"
        />
        <TabButton
          href={tabHref("published")}
          active={activeTab === "published"}
          icon={<CheckCircle2 className="size-4" />}
          label="已發布"
          count={published.length}
          tone="accent"
        />
      </div>

      {/* 版本 chips */}
      {visible.length === 0 ? (
        <p className="text-sm text-slate-500">
          {activeTab === "drafts"
            ? "目前沒有草稿。請至「發布新路線」跑一次規劃產生新草稿。"
            : "目前沒有任何已發布版本。"}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {visible.map((p) => {
            const isActive = p.id === activePlanId;
            const isPublished = p.status === "published";
            return (
              <Link
                key={p.id}
                href={planHref(p.id)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm transition",
                  isActive
                    ? isPublished
                      ? "border-accent-500 bg-accent-50 text-accent-700 font-medium"
                      : "border-amber-500 bg-amber-50 text-amber-800 font-medium"
                    : "border-slate-200 bg-white text-slate-700 hover:border-brand-300"
                )}
              >
                第 {p.version} 版
                {p.notes && <span className="ml-1 text-xs text-slate-400">· {p.notes}</span>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TabButton({
  href, active, icon, label, count, tone
}: {
  href: string;
  active: boolean;
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
    <Link
      href={href}
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
    </Link>
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

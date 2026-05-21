import { PageSkeleton } from "@/components/ui/skeleton";

/**
 * 主管後台所有頁面的全域 loading state（Next.js App Router 自動 wire-up）。
 *
 * 切頁時這個會立刻顯示，server component 還在 fetch 也不會「卡白」。
 */
export default function Loading() {
  return <PageSkeleton />;
}

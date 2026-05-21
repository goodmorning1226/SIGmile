import { cn } from "@/lib/utils/cn";

/** 灰色 pulse 區塊。Tailwind animate-pulse + bg-slate-200。 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-slate-200/70",
        className
      )}
    />
  );
}

/** 標準頁面骨架：標題 + 一排 KPI + 主要內容區。 */
export function PageSkeleton() {
  return (
    <div className="space-y-6">
      {/* page header */}
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-5">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-3 w-72" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      {/* card row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-slate-200 bg-white p-5">
            <Skeleton className="mb-3 h-3 w-16" />
            <Skeleton className="h-8 w-24" />
          </div>
        ))}
      </div>

      {/* main panel */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <Skeleton className="mb-4 h-5 w-32" />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

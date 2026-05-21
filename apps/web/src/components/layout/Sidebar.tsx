"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Truck, Send, History, Sparkles, LogOut, Layers, Users,
  Zap, LifeBuoy, Beaker, BrainCircuit, MessageSquare
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

interface NavItem { href: string; label: string; icon: typeof LayoutDashboard; }
interface NavGroup { title: string; items: readonly NavItem[]; }

const NAV: readonly NavGroup[] = [
  {
    title: "營運",
    items: [
      { href: "/dashboard", label: "今日總覽", icon: LayoutDashboard },
      { href: "/drivers",   label: "物流士",   icon: Truck }
    ]
  },
  {
    title: "即時應變",
    items: [
      { href: "/urgent",    label: "急件派遣", icon: Zap },
      { href: "/emergency", label: "緊急應變", icon: LifeBuoy }
    ]
  },
  {
    title: "路線管理",
    items: [
      { href: "/or-replanning", label: "發布新路線", icon: Send },
      { href: "/clusters",      label: "路線集",     icon: Layers },
      { href: "/assignment",    label: "物流士分配", icon: Users },
      { href: "/route-planning", label: "路線歷史",   icon: History }
    ]
  },
  {
    title: "AI 分析",
    items: [
      { href: "/ai-assistant", label: "AI 助理",     icon: MessageSquare },
      { href: "/insights",     label: "AI 深度分析", icon: BrainCircuit },
      { href: "/ai-analysis",  label: "歷史紀錄",    icon: Sparkles }
    ]
  },
  {
    title: "開發者",
    items: [
      { href: "/or-test",     label: "OR 演算法測試", icon: Beaker }
    ]
  }
];

export function Sidebar({ userName }: { userName: string }) {
  const pathname = usePathname();

  const logout = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-slate-100">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="SIGmile"
            className="size-10 shrink-0 object-contain"
          />
          <div>
            <div className="text-base font-bold leading-tight text-slate-900">SIGmile</div>
            <div className="text-xs text-slate-500">物流配送管理</div>
          </div>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV.map((group, gi) => (
          <div key={group.title} className={gi === 0 ? "" : "mt-5"}>
            <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {group.title}
            </div>
            <ul className="space-y-1">
              {group.items.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-brand-50 text-brand-700"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      )}
                    >
                      <Icon className={cn("h-4 w-4", active ? "text-brand-600" : "text-slate-400 group-hover:text-slate-600")} />
                      {item.label}
                      {active && <span className="ml-auto size-1.5 rounded-full bg-brand-600" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="border-t border-slate-100 p-3">
        <div className="flex items-center gap-3 px-2 pb-3">
          <div className="grid size-9 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
            {userName.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-slate-900">{userName}</div>
            <div className="text-xs text-slate-500">manager</div>
          </div>
        </div>
        <button
          onClick={logout}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900"
        >
          <LogOut className="h-4 w-4" />
          登出
        </button>
      </div>
    </aside>
  );
}

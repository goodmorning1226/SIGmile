import { Badge, type BadgeTone } from "@/components/ui/badge";
import type {
  JobStatus, RoutePlanStatus, TaskStatus, TaskStopStatus, UrgentStatus
} from "@/types/domain";

type AnyStatus = TaskStatus | TaskStopStatus | JobStatus | RoutePlanStatus | UrgentStatus | "active" | "draft" | "archived";

const MAP: Record<string, { label: string; tone: BadgeTone }> = {
  // task / task_stop / job 共用
  pending:      { label: "待處理",  tone: "neutral" },
  in_progress:  { label: "進行中",  tone: "info"    },
  running:      { label: "執行中",  tone: "info"    },
  navigating:   { label: "導航中",  tone: "info"    },
  arrived:      { label: "已抵達",  tone: "info"    },
  completed:    { label: "已完成",  tone: "success" },
  failed:       { label: "失敗",    tone: "danger"  },
  skipped:      { label: "已略過",  tone: "warning" },
  cancelled:    { label: "已取消",  tone: "neutral" },
  // route_plan
  draft:        { label: "草稿",    tone: "warning" },
  published:    { label: "已發布",  tone: "success" },
  archived:     { label: "已封存",  tone: "neutral" },
  // urgent
  assigned:     { label: "已指派",  tone: "info"    },
  // period
  active:       { label: "啟用中",  tone: "success" }
};

export function StatusBadge({ status }: { status: AnyStatus }) {
  const m = MAP[status] ?? { label: String(status), tone: "neutral" as BadgeTone };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

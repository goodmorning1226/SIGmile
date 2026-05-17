import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Route Plan 操作：
 *   - createDraftPlan：新增 draft 版本（自動 +1 version）
 *   - publishPlan：把指定 plan 標記為 published，並把同 period 其它已 published 改 archived
 *   - reorderStops：依 manager 操作更新一組 route_stops 的 stop_order
 *   - generateDailyTasksFromPublished：把 published plan 展開成今日 delivery_tasks
 *     （MVP 同步呼叫即可；之後可改 cron）
 */
export class RoutePlanService {
  async createDraftPlan(input: {
    planning_period_id: string;
    created_by: string | null;
    notes?: string;
  }): Promise<{ id: string; version: number }> {
    const admin = createSupabaseAdminClient();
    const { data: maxRow } = await admin
      .from("route_plans")
      .select("version")
      .eq("planning_period_id", input.planning_period_id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (maxRow?.version ?? 0) + 1;

    const { data, error } = await admin
      .from("route_plans")
      .insert({
        planning_period_id: input.planning_period_id,
        version: nextVersion,
        status: "draft",
        source: "manual",
        created_by: input.created_by,
        notes: input.notes ?? null
      })
      .select("id, version")
      .single();
    if (error || !data) throw error ?? new Error("Failed to create route_plan");
    return { id: data.id, version: data.version };
  }

  async publishPlan(planId: string): Promise<void> {
    const admin = createSupabaseAdminClient();

    const { data: plan, error } = await admin
      .from("route_plans")
      .select("id, planning_period_id, status")
      .eq("id", planId)
      .single();
    if (error || !plan) throw error ?? new Error("Plan not found");
    if (plan.status === "archived") throw new Error("Cannot publish an archived plan");

    // 同 period 其它已 published → archived
    await admin
      .from("route_plans")
      .update({ status: "archived" })
      .eq("planning_period_id", plan.planning_period_id)
      .eq("status", "published")
      .neq("id", planId);

    await admin
      .from("route_plans")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", planId);
  }

  async reorderStops(items: Array<{ id: string; stop_order: number }>): Promise<void> {
    if (items.length === 0) return;
    const admin = createSupabaseAdminClient();
    // 雙階段：先把所有 stop_order 推到負值避開 unique 衝突，再寫入新值
    for (const it of items) {
      await admin.from("route_stops").update({ stop_order: -Math.abs(it.stop_order) - 1000 }).eq("id", it.id);
    }
    for (const it of items) {
      await admin.from("route_stops").update({ stop_order: it.stop_order }).eq("id", it.id);
    }
  }

  /**
   * 把 published plan 展開成 delivery_tasks + delivery_task_stops（指定日期；預設今天）
   * 已存在的同 (date, driver) task 會被略過。
   */
  async generateDailyTasksFromPublished(planId: string, dateISO?: string): Promise<{ tasksCreated: number }> {
    const admin = createSupabaseAdminClient();
    const date = dateISO ?? todayInTaipei();

    const { data: plan, error } = await admin
      .from("route_plans")
      .select("id, status")
      .eq("id", planId)
      .single();
    if (error || !plan) throw error ?? new Error("Plan not found");
    if (plan.status !== "published") throw new Error("Plan is not published");

    const { data: assignments } = await admin
      .from("driver_route_assignments")
      .select("id, driver_id")
      .eq("route_plan_id", planId);

    let created = 0;
    for (const a of assignments ?? []) {
      const { data: exists } = await admin
        .from("delivery_tasks")
        .select("id")
        .eq("delivery_date", date)
        .eq("driver_id", a.driver_id)
        .maybeSingle();
      if (exists) continue;

      const { data: rs } = await admin
        .from("route_stops")
        .select("id, stop_id, stop_order, estimated_arrival_time")
        .eq("driver_route_assignment_id", a.id)
        .order("stop_order", { ascending: true });

      const firstStopId = rs?.[0]?.stop_id ?? null;

      const { data: newTask, error: taskErr } = await admin
        .from("delivery_tasks")
        .insert({
          delivery_date: date,
          driver_id: a.driver_id,
          driver_route_assignment_id: a.id,
          status: "pending",
          current_stop_id: firstStopId
        })
        .select("id")
        .single();
      if (taskErr || !newTask) throw taskErr ?? new Error("Failed to create task");

      const rows = (rs ?? []).map((r) => ({
        delivery_task_id: newTask.id,
        route_stop_id:    r.id,
        stop_id:          r.stop_id,
        stop_order:       r.stop_order,
        status:           "pending" as const,
        planned_arrival_at: r.estimated_arrival_time
          ? new Date(`${date}T${r.estimated_arrival_time}+08:00`).toISOString()
          : null
      }));
      if (rows.length > 0) {
        const { error: dtsErr } = await admin.from("delivery_task_stops").insert(rows);
        if (dtsErr) throw dtsErr;
      }
      created++;
    }
    return { tasksCreated: created };
  }
}

function todayInTaipei(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.APP_TIMEZONE ?? "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit"
  });
  return fmt.format(new Date());
}

export const routePlanService = new RoutePlanService();

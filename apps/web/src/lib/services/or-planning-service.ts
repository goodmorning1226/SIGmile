import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { OrOutputPlanV1 } from "@/types/domain";

/**
 * OR 規劃服務。MVP 採 mock：用 round-robin 把 stops 平均分給 drivers。
 *
 * 未來替換點：
 *   - 把 runMockPlanningJob 改成呼叫 OR-Tools / 自家 solver，
 *     輸出仍寫入 or_planning_jobs.output_plan (jsonb)。
 *   - convertOutputToRoutePlan 依 OrOutputPlanV1 解析，
 *     新版輸出只要符合 schema 即相容。
 */
export interface CreatePlanningJobInput {
  planning_period_id: string;
  requested_by: string | null;
  input_parameters: Record<string, unknown>;
}

export interface IORPlanningService {
  createPlanningJob(input: CreatePlanningJobInput): Promise<{ jobId: string }>;
  runMockPlanningJob(jobId: string): Promise<{ output_plan: OrOutputPlanV1 }>;
  convertOutputToRoutePlan(jobId: string, createdBy: string | null): Promise<{ routePlanId: string }>;
}

export class MockORPlanningService implements IORPlanningService {
  async createPlanningJob(input: CreatePlanningJobInput) {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("or_planning_jobs")
      .insert({
        planning_period_id: input.planning_period_id,
        requested_by: input.requested_by,
        input_parameters: input.input_parameters,
        status: "pending"
      })
      .select("id")
      .single();
    if (error) throw error;
    return { jobId: data.id as string };
  }

  async runMockPlanningJob(jobId: string) {
    const admin = createSupabaseAdminClient();

    const { data: job, error: jobErr } = await admin
      .from("or_planning_jobs")
      .select("id, planning_period_id, input_parameters")
      .eq("id", jobId)
      .single();
    if (jobErr || !job) throw jobErr ?? new Error("OR job not found");

    await admin
      .from("or_planning_jobs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", jobId);

    const { data: period } = await admin
      .from("planning_periods")
      .select("id, distribution_center_id")
      .eq("id", job.planning_period_id)
      .single();

    const { data: drivers } = await admin
      .from("profiles")
      .select("id, full_name")
      .eq("role", "driver")
      .eq("is_active", true)
      .eq("distribution_center_id", period?.distribution_center_id ?? null);

    const { data: stops } = await admin
      .from("stops")
      .select("id, default_service_minutes")
      .eq("is_active", true)
      .limit(200);

    const driverList = drivers ?? [];
    const stopList   = stops ?? [];

    // round-robin 派送
    const output_plan: OrOutputPlanV1 = {
      engine: "mock",
      generated_at: new Date().toISOString(),
      drivers: driverList.map((d, i) => {
        const assigned = stopList.filter((_, idx) => idx % Math.max(1, driverList.length) === i);
        let cursorMin = 8 * 60 + 30;     // 08:30 起跑
        return {
          driver_id: d.id,
          route_name: `R-${i + 1}`,
          estimated_total_minutes: assigned.length * 20,
          estimated_total_distance_meters: assigned.length * 1500,
          stops: assigned.map((s, k) => {
            const arrival = formatHM(cursorMin);
            cursorMin += (s.default_service_minutes ?? 10) + 10;
            return {
              stop_id: s.id,
              stop_order: k + 1,
              estimated_arrival_time: arrival,
              estimated_service_minutes: s.default_service_minutes ?? 10
            };
          })
        };
      })
    };

    await admin
      .from("or_planning_jobs")
      .update({
        status: "completed",
        output_plan,
        completed_at: new Date().toISOString(),
        engine_version: "mock-v0"
      })
      .eq("id", jobId);

    return { output_plan };
  }

  async convertOutputToRoutePlan(jobId: string, createdBy: string | null) {
    const admin = createSupabaseAdminClient();

    const { data: job, error } = await admin
      .from("or_planning_jobs")
      .select("id, planning_period_id, output_plan, created_route_plan_id")
      .eq("id", jobId)
      .single();
    if (error || !job) throw error ?? new Error("OR job not found");
    if (job.created_route_plan_id) return { routePlanId: job.created_route_plan_id as string };

    const output = job.output_plan as OrOutputPlanV1;

    // 取得目前最大 version
    const { data: maxRow } = await admin
      .from("route_plans")
      .select("version")
      .eq("planning_period_id", job.planning_period_id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (maxRow?.version ?? 0) + 1;

    const { data: plan, error: planErr } = await admin
      .from("route_plans")
      .insert({
        planning_period_id: job.planning_period_id,
        version: nextVersion,
        status: "draft",
        source: "or_mock",
        source_or_job_id: job.id,
        created_by: createdBy,
        notes: `由 OR job ${job.id} mock 結果建立`
      })
      .select("id")
      .single();
    if (planErr || !plan) throw planErr ?? new Error("Failed to create route_plan");

    // 寫 assignments + route_stops
    for (let i = 0; i < output.drivers.length; i++) {
      const d = output.drivers[i];
      const { data: dra, error: draErr } = await admin
        .from("driver_route_assignments")
        .insert({
          route_plan_id: plan.id,
          driver_id: d.driver_id,
          route_name: d.route_name,
          sequence: i + 1,
          estimated_total_minutes: d.estimated_total_minutes,
          estimated_total_distance_meters: d.estimated_total_distance_meters
        })
        .select("id")
        .single();
      if (draErr) throw draErr;

      if (d.stops.length > 0) {
        const rows = d.stops.map((s) => ({
          driver_route_assignment_id: dra.id,
          stop_id: s.stop_id,
          stop_order: s.stop_order,
          estimated_arrival_time: s.estimated_arrival_time,
          estimated_service_minutes: s.estimated_service_minutes
        }));
        const { error: rsErr } = await admin.from("route_stops").insert(rows);
        if (rsErr) throw rsErr;
      }
    }

    await admin
      .from("or_planning_jobs")
      .update({ created_route_plan_id: plan.id })
      .eq("id", job.id);

    return { routePlanId: plan.id as string };
  }
}

function formatHM(minOfDay: number): string {
  const h = Math.floor(minOfDay / 60).toString().padStart(2, "0");
  const m = (minOfDay % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

export const orPlanningService: IORPlanningService = new MockORPlanningService();

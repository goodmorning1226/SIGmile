import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * AI Insights Service — 比原本的 MockAIService 多 4 個維度。
 *
 * 仍然是 rule-based mock（沒接 Claude/GPT），但**所有 insight 都從真實 DB 算出**：
 *   1. 整體 KPI（completion / on_time）
 *   2. 時段熱力圖（hour-of-day 完成率）— 找出「下午幾點 collapse」
 *   3. 物流士排名 + outlier detection (z-score)
 *   4. 門市異常熱點（recurring failures 同一個 stop）
 *   5. 風險預警（accumulate ahead-of-schedule 樂觀 vs slip）
 *   6. 可執行建議（actionable next step，不只是 "聯繫主管"）
 *
 * 之後接 Anthropic Claude 只要：把這個 file 的 `summary` 改成「prompt + JSON schema + Claude call」即可。
 */

export interface AIInsightInput {
  /** 預設今天 (Taipei tz) */
  date?: string;
  /** 比較區間 (default = 過去 7 天) */
  comparison_days?: number;
}

export interface AIInsight {
  generated_at: string;
  snapshot_date: string;
  risk_level: "low" | "medium" | "high";
  /** ≤ 200 字的 executive summary */
  headline: string;
  /** 圖卡用 */
  kpi: {
    completion_rate: number;
    on_time_rate: number;
    delayed_stop_count: number;
    total_stops: number;
    in_progress_drivers: number;
    completed_drivers: number;
    delta_vs_average: {
      completion_pp: number;        // 百分點，正 = 比歷史好
      on_time_pp: number;
    };
  };
  /** 0..23 點，每小時完成率（瞬時 + 累積） */
  hourly_progress: Array<{
    hour: number;
    completed: number;
    cumulative_completion_rate: number;
  }>;
  /** 找到「異常時段」— 例如午後雷陣雨那種斷層 */
  bottleneck_hours: Array<{
    hour: number;
    reason: string;     // "完成站數 / 該時段預期 = 38% (預期 75%)"
    severity: "warn" | "high";
  }>;
  /** 物流士 outlier — z-score < -1 或 > 1 */
  driver_outliers: Array<{
    driver_id: string;
    driver_name: string;
    employee_code: string | null;
    completion_rate: number;
    on_time_rate: number;
    note: string;
    kind: "behind" | "ahead" | "high_exception";
  }>;
  /** 門市異常熱點 — 過去 N 天 該 stop_id 失敗 ≥ 2 次 */
  problem_stops: Array<{
    stop_id: string;
    stop_name: string;
    fail_count: number;
    last_fail_reason: string | null;
    suggestion: string;
  }>;
  /** 延誤路線（每位 driver 一條） */
  delayed_routes: Array<{
    driver_id: string;
    driver_name: string;
    route_name: string;
    delayed_stops: number;
    estimated_delay_minutes: number;
  }>;
  /** 排程的具體 next step（不是泛泛建議） */
  actions: Array<{
    priority: "p0" | "p1" | "p2";
    text: string;
    action_hint?: string;   // UI 上對應的按鈕 / 連結提示
  }>;
}

export async function buildInsight(input: AIInsightInput = {}): Promise<AIInsight> {
  const admin = createSupabaseAdminClient();
  const tz = process.env.APP_TIMEZONE ?? "Asia/Taipei";
  const today = input.date ?? new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
  const histDays = input.comparison_days ?? 7;

  // ─── 1. 今日 tasks + stops ───
  interface TaskRow {
    id: string;
    driver_id: string;
    status: string;
    driver: { full_name: string; employee_code: string | null } | { full_name: string; employee_code: string | null }[] | null;
    assignment: { route_name: string } | { route_name: string }[] | null;
  }
  interface StopRow {
    delivery_task_id: string;
    stop_id: string;
    status: string;
    on_time: boolean | null;
    completed_at: string | null;
    planned_arrival_at: string | null;
    actual_arrival_at: string | null;
    store_checkin_at: string | null;
    exception_reason: string | null;
    exception_note: string | null;
    stop: { id: string; name: string; external_code: string | null } | { id: string; name: string; external_code: string | null }[] | null;
  }
  const pickFirst = <T,>(v: T | T[] | null | undefined): T | null =>
    !v ? null : Array.isArray(v) ? v[0] ?? null : v;

  const { data: tasksToday } = await admin
    .from("delivery_tasks")
    .select(
      "id, driver_id, status, " +
        "driver:profiles(full_name, employee_code), " +
        "assignment:driver_route_assignments(route_name)"
    )
    .eq("delivery_date", today)
    .returns<TaskRow[]>();

  const taskList = tasksToday ?? [];
  const taskIds = taskList.map((t) => t.id);

  const stopRows: StopRow[] = taskIds.length === 0 ? [] : (
    (await admin
      .from("delivery_task_stops")
      .select(
        "delivery_task_id, stop_id, status, on_time, completed_at, " +
          "planned_arrival_at, actual_arrival_at, store_checkin_at, " +
          "exception_reason, exception_note, " +
          "stop:stops(id, name, external_code)"
      )
      .in("delivery_task_id", taskIds)
      .returns<StopRow[]>()).data ?? []
  );

  // ─── 2. 歷史 baseline (past N days, excluding today) ───
  const histStart = new Date();
  histStart.setUTCDate(histStart.getUTCDate() - histDays);
  const histStartStr = histStart.toISOString().slice(0, 10);

  interface HistAgg {
    completion_rate: number;
    on_time_rate: number;
  }
  const { data: histTasks } = await admin
    .from("delivery_tasks")
    .select("id, delivery_date")
    .gte("delivery_date", histStartStr)
    .lt("delivery_date", today)
    .returns<Array<{ id: string; delivery_date: string }>>();
  const histTaskIds = (histTasks ?? []).map((t) => t.id);
  const { data: histStops } = histTaskIds.length === 0
    ? { data: [] }
    : await admin
      .from("delivery_task_stops")
      .select("status, on_time")
      .in("delivery_task_id", histTaskIds)
      .returns<Array<{ status: string; on_time: boolean | null }>>();
  const histAgg: HistAgg = (() => {
    const all = histStops ?? [];
    if (all.length === 0) return { completion_rate: 0, on_time_rate: 0 };
    const completed = all.filter((s) => s.status === "completed").length;
    const onTime = all.filter((s) => s.on_time === true).length;
    return {
      completion_rate: completed / all.length,
      on_time_rate: completed === 0 ? 0 : onTime / completed
    };
  })();

  // ─── 3. 今日 KPI ───
  const total = stopRows.length;
  const completed = stopRows.filter((s) => s.status === "completed").length;
  const onTime = stopRows.filter((s) => s.on_time === true).length;
  const failed = stopRows.filter((s) => s.status === "failed" || s.exception_reason).length;
  const completion_rate = total === 0 ? 0 : completed / total;
  const on_time_rate = completed === 0 ? 0 : onTime / completed;

  // ─── 4. 時段熱力 + bottleneck detection ───
  const hourCount = new Array(24).fill(0);
  const hourFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", hour12: false
  });
  for (const s of stopRows) {
    if (s.status !== "completed" || !s.completed_at) continue;
    const h = parseInt(hourFmt.format(new Date(s.completed_at)), 10);
    if (!Number.isNaN(h)) hourCount[h]++;
  }
  const hourly_progress: AIInsight["hourly_progress"] = [];
  let cum = 0;
  for (let h = 6; h <= 22; h++) {
    cum += hourCount[h];
    hourly_progress.push({
      hour: h,
      completed: hourCount[h],
      cumulative_completion_rate: total === 0 ? 0 : cum / total
    });
  }
  // Expected progress curve: linear from 8AM->18:00
  const bottleneck_hours: AIInsight["bottleneck_hours"] = [];
  const nowH = parseInt(hourFmt.format(new Date()), 10);
  for (const p of hourly_progress) {
    if (p.hour > nowH) break;
    if (p.hour < 8) continue;
    const expected_pct = Math.max(0, Math.min(1, (p.hour - 8) / 10));
    if (expected_pct === 0) continue;
    const actual = p.cumulative_completion_rate;
    const deficit = expected_pct - actual;
    if (deficit > 0.25) {
      bottleneck_hours.push({
        hour: p.hour,
        reason: `截至 ${p.hour}:00 累積完成率 ${(actual * 100).toFixed(0)}%（預期 ${(expected_pct * 100).toFixed(0)}%）`,
        severity: deficit > 0.4 ? "high" : "warn"
      });
    }
  }

  // ─── 5. 物流士 outlier (z-score) ───
  const driverStats = new Map<string, {
    driver_id: string; driver_name: string; employee_code: string | null;
    task_status: string; total: number; completed: number; on_time: number; exception: number;
  }>();
  for (const t of taskList) {
    const driver = pickFirst(t.driver);
    driverStats.set(t.id, {
      driver_id: t.driver_id,
      driver_name: driver?.full_name ?? "(未知)",
      employee_code: driver?.employee_code ?? null,
      task_status: t.status,
      total: 0, completed: 0, on_time: 0, exception: 0
    });
  }
  for (const s of stopRows) {
    const d = driverStats.get(s.delivery_task_id);
    if (!d) continue;
    d.total++;
    if (s.status === "completed") d.completed++;
    if (s.on_time === true) d.on_time++;
    if (s.exception_reason || s.status === "failed") d.exception++;
  }
  const driverList = [...driverStats.values()].filter((d) => d.total > 0);
  const rates = driverList.map((d) => d.completed / d.total);
  const mean = rates.length === 0 ? 0 : rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance = rates.length === 0 ? 0 :
    rates.reduce((a, b) => a + (b - mean) ** 2, 0) / rates.length;
  const stdev = Math.sqrt(variance);
  const driver_outliers: AIInsight["driver_outliers"] = [];
  for (const d of driverList) {
    const dRate = d.total === 0 ? 0 : d.completed / d.total;
    const z = stdev === 0 ? 0 : (dRate - mean) / stdev;
    const onTimeRate = d.completed === 0 ? 0 : d.on_time / d.completed;
    if (z < -1) {
      driver_outliers.push({
        driver_id: d.driver_id,
        driver_name: d.driver_name,
        employee_code: d.employee_code,
        completion_rate: dRate,
        on_time_rate: onTimeRate,
        kind: "behind",
        note: `比同儕平均完成率慢 ${((mean - dRate) * 100).toFixed(0)} pp (z=${z.toFixed(2)})`
      });
    } else if (z > 1) {
      driver_outliers.push({
        driver_id: d.driver_id,
        driver_name: d.driver_name,
        employee_code: d.employee_code,
        completion_rate: dRate,
        on_time_rate: onTimeRate,
        kind: "ahead",
        note: `領先同儕 ${((dRate - mean) * 100).toFixed(0)} pp，可考慮支援慢線`
      });
    }
    if (d.exception > 0) {
      driver_outliers.push({
        driver_id: d.driver_id,
        driver_name: d.driver_name,
        employee_code: d.employee_code,
        completion_rate: dRate,
        on_time_rate: onTimeRate,
        kind: "high_exception",
        note: `${d.exception} 件異常 — 建議主管聯繫`
      });
    }
  }

  // ─── 6. 門市異常熱點 (今日 + 歷史 N 天) ───
  const stopFailMap = new Map<string, {
    stop_id: string; stop_name: string; fail_count: number;
    last_fail_reason: string | null;
  }>();
  for (const s of stopRows) {
    if (s.status === "failed" || s.exception_reason) {
      const stop = pickFirst(s.stop);
      const key = s.stop_id;
      const entry = stopFailMap.get(key) ?? {
        stop_id: key,
        stop_name: stop?.name ?? key,
        fail_count: 0,
        last_fail_reason: null
      };
      entry.fail_count++;
      entry.last_fail_reason = s.exception_reason ?? s.exception_note ?? entry.last_fail_reason;
      stopFailMap.set(key, entry);
    }
  }
  // 歷史亦看
  if (histTaskIds.length > 0) {
    const { data: histFails } = await admin
      .from("delivery_task_stops")
      .select("stop_id, exception_reason, stop:stops(name)")
      .in("delivery_task_id", histTaskIds)
      .or("status.eq.failed,exception_reason.not.is.null")
      .returns<Array<{
        stop_id: string;
        exception_reason: string | null;
        stop: { name: string } | { name: string }[] | null;
      }>>();
    for (const h of histFails ?? []) {
      const entry = stopFailMap.get(h.stop_id) ?? {
        stop_id: h.stop_id,
        stop_name: pickFirst(h.stop)?.name ?? h.stop_id,
        fail_count: 0,
        last_fail_reason: null
      };
      entry.fail_count++;
      entry.last_fail_reason = h.exception_reason ?? entry.last_fail_reason;
      stopFailMap.set(h.stop_id, entry);
    }
  }
  const problem_stops: AIInsight["problem_stops"] = [...stopFailMap.values()]
    .filter((s) => s.fail_count >= 2)
    .sort((a, b) => b.fail_count - a.fail_count)
    .slice(0, 5)
    .map((s) => ({
      stop_id: s.stop_id,
      stop_name: s.stop_name,
      fail_count: s.fail_count,
      last_fail_reason: s.last_fail_reason,
      suggestion: s.fail_count >= 3
        ? "建議聯繫業務，確認門市收貨時間是否需調整"
        : "下次排班可考慮放在較有經驗的物流士路線"
    }));

  // ─── 7. 延誤 routes ───
  //   一條路線進入「延誤」清單只當：
  //     (a) 已完成 / skipped 但 on_time=false 且實際晚於 planned 超過 15 分；或
  //     (b) 仍 pending/navigating，且現在已超過 planned > 15 分
  //   maxDelay 取所有「真實延誤分鐘數」的最大值（不是 0 也不是估值）
  const now = Date.now();
  const delayed_routes: AIInsight["delayed_routes"] = [];
  const DELAY_THRESHOLD = 15;
  for (const t of taskList) {
    const driver = pickFirst(t.driver);
    const assign = pickFirst(t.assignment);
    const ownStops = stopRows.filter((s) => s.delivery_task_id === t.id);
    let count = 0, maxDelay = 0;
    for (const s of ownStops) {
      if (!s.planned_arrival_at) continue;
      const planned = new Date(s.planned_arrival_at).getTime();

      let diff: number | null = null;
      if (s.status === "completed" || s.status === "skipped") {
        // 已完成 / 略過：用實際抵達時間算延誤；on_time=false 才視為延誤
        if (s.on_time === false && s.actual_arrival_at) {
          diff = Math.round((new Date(s.actual_arrival_at).getTime() - planned) / 60_000);
        }
      } else {
        // 還在進行：用「現在 vs planned」算還在延誤多久
        const ref = s.actual_arrival_at ? new Date(s.actual_arrival_at).getTime() : now;
        diff = Math.round((ref - planned) / 60_000);
      }

      if (diff != null && diff > DELAY_THRESHOLD) {
        count++;
        if (diff > maxDelay) maxDelay = diff;
      }
    }
    if (count > 0) {
      delayed_routes.push({
        driver_id: t.driver_id,
        driver_name: driver?.full_name ?? "(未知)",
        route_name: assign?.route_name ?? "—",
        delayed_stops: count,
        estimated_delay_minutes: maxDelay
      });
    }
  }

  // ─── 8. Risk + actions ───
  const risk: AIInsight["risk_level"] =
    completion_rate < 0.5 || on_time_rate < 0.6 || failed >= 3 || delayed_routes.length >= 2 ? "high"
      : completion_rate < 0.8 || on_time_rate < 0.85 || failed >= 1 || delayed_routes.length >= 1 ? "medium"
        : "low";

  const actions: AIInsight["actions"] = [];
  if (risk === "high") {
    if (delayed_routes.length >= 2) {
      actions.push({
        priority: "p0",
        text: `${delayed_routes.length} 條路線延誤 ≥ 15 分，建議立即進入「緊急應變」頁將最慢路線剩餘 stop 派給空閒物流士`,
        action_hint: "前往 /emergency"
      });
    }
    if (failed >= 3) {
      actions.push({
        priority: "p0",
        text: `今日已 ${failed} 件異常，建議聯繫第一線確認是否需要支援車輛 / 物流士`,
        action_hint: "查看 /dashboard 異常清單"
      });
    }
  }
  if (driver_outliers.some((d) => d.kind === "behind")) {
    actions.push({
      priority: "p1",
      text: `${driver_outliers.filter((d) => d.kind === "behind").length} 位物流士落後同儕平均，建議檢查當下狀況`,
      action_hint: "/drivers"
    });
  }
  if (problem_stops.length >= 2) {
    actions.push({
      priority: "p1",
      text: `${problem_stops.length} 個門市過去 ${histDays} 天累積異常 ≥ 2 次，建議與業務協調`,
      action_hint: "查看下方門市熱點"
    });
  }
  if (bottleneck_hours.some((b) => b.severity === "high")) {
    actions.push({
      priority: "p1",
      text: `下午時段累積進度落後預期 ≥ 40%，建議檢查是否為交通 / 天氣事件導致`,
      action_hint: "/dashboard hourly chart"
    });
  }
  if (actions.length === 0) {
    actions.push({
      priority: "p2",
      text: "目前無顯著風險 — 持續監控午後完成率 + 異常回報",
      action_hint: undefined
    });
  }

  // ─── 9. Headline ───
  const completionDelta = completion_rate - histAgg.completion_rate;
  const onTimeDelta     = on_time_rate    - histAgg.on_time_rate;
  const deltaStr = (n: number) => (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + " pp";

  const headline =
    `今日 ${completed}/${total} 站完成（${(completion_rate * 100).toFixed(0)}%）、` +
    `準時 ${(on_time_rate * 100).toFixed(0)}%。` +
    `vs 過去 ${histDays} 天平均：完成 ${deltaStr(completionDelta)}、準時 ${deltaStr(onTimeDelta)}。` +
    (delayed_routes.length > 0
      ? ` ${delayed_routes.length} 條路線延誤 ≥ 15 分。`
      : ` 無顯著延誤。`) +
    (driver_outliers.filter((d) => d.kind === "behind").length > 0
      ? ` ${driver_outliers.filter((d) => d.kind === "behind").length} 位物流士落後同儕。`
      : "") +
    (problem_stops.length > 0
      ? ` ${problem_stops.length} 個門市為異常熱點。`
      : "");

  return {
    generated_at: new Date().toISOString(),
    snapshot_date: today,
    risk_level: risk,
    headline,
    kpi: {
      completion_rate,
      on_time_rate,
      delayed_stop_count: delayed_routes.reduce((s, r) => s + r.delayed_stops, 0),
      total_stops: total,
      in_progress_drivers: taskList.filter((t) => t.status === "in_progress").length,
      completed_drivers:   taskList.filter((t) => t.status === "completed").length,
      delta_vs_average: {
        completion_pp: completionDelta,
        on_time_pp:    onTimeDelta
      }
    },
    hourly_progress,
    bottleneck_hours,
    driver_outliers,
    problem_stops,
    delayed_routes,
    actions
  };
}

import type { OrOutputPlanV1 } from "@/types/domain";

/**
 * OR 路線規劃 — 完整型別系統 (v2)
 * 完整設計文件: docs/OR_DESIGN.md
 *
 * 五層架構:
 *   ① Learning   — Inverse VRP 從歷史 recover weights      (learning/)
 *   ② Strategic  — 季度 driver-route 派工                   (strategic/)
 *   ③ Tactical   — 日 stops 排序                            (tactical/)
 *   ④ Auto-pilot — 規則 meta-policy 自動挑算法              (autopilot/)
 *   ⑤ Explain    — headline / reason tag / confidence       (explain/)
 */

// ========================================================================
// ② 戰略層 — 季度 driver-route 派工
// ========================================================================
export type StrategicPersonality =
  | "strat_history_lock"          // S1 沿用歷史派工 (baseline / fallback)
  | "strat_hungarian"             // S2 全局派工最佳化 — Hungarian / Munkres
  | "strat_set_partition"         // S3 切平衡 beat — CP-SAT
  | "strat_multi_period_vrp"      // S4 多週期路線 — 週循環
  | "strat_quarterly_fair"        // S5 季度工時公平 — min σ(total_minutes)
  | "strat_apprentice_mix";       // S6 學徒模式 — 新人短/老手難

// ========================================================================
// ③ 戰術層 — 日 stops 排序 (v1 14 人格，前綴改 tac_)
// ========================================================================
export type TacticalPersonality =
  | "tac_tsp_min_distance"        // T1
  | "tac_vrptw_min_lateness"      // T2  ★ Phase 0 default
  | "tac_cvrp_balanced_capacity"  // T3
  | "tac_top_vip_first"           // T4
  | "tac_min_makespan"            // T5
  | "tac_min_max_workload"        // T6
  | "tac_robust_traffic_p80"      // T7
  | "tac_cluster_then_tsp"        // T8
  | "tac_sweep_polar"             // T9  ★ Phase 0 baseline (pure TS)
  | "tac_clarke_wright_savings"   // T10
  | "tac_green_eco"               // T11
  | "tac_cx_min_wait"             // T12
  | "tac_dynamic_insert"          // T13
  | "tac_alns_best_quality";      // T14

export const PHASE_0_STRATEGIC: StrategicPersonality[] = [
  "strat_history_lock",
  "strat_hungarian"
];

export const PHASE_0_TACTICAL: TacticalPersonality[] = [
  "tac_sweep_polar",
  "tac_vrptw_min_lateness"
];

// ========================================================================
// ④ Auto-pilot 觸發條件 → 算法組合
// ========================================================================
export type AutopilotTrigger =
  | "season_start"          // 季初新建排班
  | "driver_shortage"       // 缺工 (出勤 < 80%)
  | "peak_season"           // 大檔期 / 雙 11
  | "urgent_insert"         // 24h 內急件
  | "manager_compare"       // 主管手動觸發比較
  | "engine_down";          // OR 引擎掛掉 fallback

export interface AutopilotChoice {
  strategic:           StrategicPersonality;
  tactical:            TacticalPersonality;
  use_history_weights: boolean;
  reason:              string;       // 為什麼挑這組
}

// ========================================================================
// 共用 OR Input — 戰略 / 戰術都吃
// ========================================================================
export interface ORStopInput {
  stop_id:         string;
  lat:             number;
  lng:             number;
  demand_boxes:    number;
  service_minutes: number;
  /** 時間窗起 (since 00:00, minutes); null = 無限制 */
  tw_start_min:    number | null;
  tw_end_min:      number | null;
  temperature:     string;
  /** 0–100; T4 VIP 模式吃這欄 */
  priority:        number;
}

export interface ORDriverInput {
  driver_id:               string;
  vehicle_id:              string;
  capacity_boxes:          number;
  shift_start_min:         number;
  shift_end_min:           number;
  temperature_capability:  string[];
  /** 從 driver_skill_profile join 進來; 戰略層 S6 用 */
  seniority_quarters?:     number;
  historical_on_time_rate?: number;
}

export interface ORInput {
  depot:    { lat: number; lng: number; depot_id: string };
  stops:    ORStopInput[];
  drivers:  ORDriverInput[];
  /** N×N — N = stops.length + 1 (index 0 = depot) */
  matrix:   { distance_m: number[][]; time_s: number[][] };
  /** 從 ① 學歷史拿到的權重; null = 沒學過, 用 manual */
  weights?: RecoveredWeights | null;
  /** Solver budget (ms); sweep 用不到，OR-Tools 用 GLS 上限 */
  budget_ms?: number;
}

// ========================================================================
// Strategy interface — 戰略 / 戰術都實作這個
// ========================================================================
export interface RoutePersonalityStrategy<
  TInput  = ORInput,
  TOutput = OrOutputPlanV2
> {
  id:                 StrategicPersonality | TacticalPersonality;
  layer:              "strategic" | "tactical";
  label_zh:           string;
  description_zh:     string;
  /** dispatcher 用來檢查 input 完整性 */
  required_fields:    Array<"matrix" | "weights" | keyof ORStopInput>;
  solve(input: TInput): Promise<TOutput>;
}

// ========================================================================
// ① 學歷史層 — Inverse VRP 輸出
// ========================================================================
export interface RecoveredWeights {
  depot_id:      string;
  shift:         string;
  w_distance:    number;
  w_time:        number;
  w_capacity:    number;
  w_vip:         number;
  w_balance:     number;
  /** hold-out Kendall-τ; v2 文件門檻 ≥ 0.6 */
  holdout_tau:   number;
  trained_at:    string;        // ISO timestamp
  n_samples:     number;
  /** 不收斂 / 樣本不足時 fallback 到均勻權重 */
  is_fallback:   boolean;
}

export interface InverseOptRequest {
  depot_id:  string;
  shift:     string;
  since:     string;            // ISO date 抓哪天之後的歷史
  algorithm?: "structured_svm" | "max_ent_irl";   // 預設 SVM
}

// ========================================================================
// ⑤ 解釋層 — headline + reason tag + confidence
// ========================================================================
export type ReasonTagId =
  | "cold_chain_priority"       // 🌡️ 冷凍貨優先
  | "time_window_fit"           // 🕒 時間窗匹配
  | "geographic_adjacency"      // 🛣️ 順路
  | "apprentice_short_route"    // 👥 新人短路
  | "vip_first"                 // ⭐ VIP 先送
  | "capacity_balance"          // ⚖️ 容量平衡
  | "history_pattern"           // 📜 沿用歷史
  | "urgent_insertion";         // 🚨 急件插入

export interface ReasonTag {
  id:        ReasonTagId;
  label_zh:  string;
  detail:    string;            // e.g. "從 S087 出來右轉就到"
}

export interface HistoryComparison {
  reference_route_id:   string;     // e.g. "R1215"
  total_distance_pct:   number;     // -0.082 = 短了 8.2%
  on_time_rate_delta:   number;     // 0.024 = +2.4pp
  workload_stddev_pct:  number;
  /** 與歷史相鄰站點對 (i, j) 的保留率 0–1 */
  adjacent_pair_kept:   number;
}

export interface PlanMetrics {
  total_distance_m:        number;
  total_minutes:           number;
  makespan_minutes:        number;
  workload_stddev:         number;
  on_time_estimated_rate:  number;
  vip_coverage_rate?:      number;
}

// ========================================================================
// Output V2 — 向後相容 V1
// ========================================================================
export interface OrOutputPlanV2 extends Omit<OrOutputPlanV1, "engine"> {
  engine:           string;       // e.g. "auto-v2.s2-hungarian+t2-vrptw"
  strategic_used:   StrategicPersonality | null;
  tactical_used:    TacticalPersonality;
  weights_used:     RecoveredWeights | null;
  metrics:          PlanMetrics;
  comparison?:      HistoryComparison;
  /** 0–1; <0.6 UI 標紅必須手動 review */
  confidence:       number;
  /** Map<stop_id, ReasonTag[]> — 解釋層輸出 */
  reasons?:         Record<string, ReasonTag[]>;
}

// ========================================================================
// Input V2 — 對應 OrInputForm 擴充
// ========================================================================
export interface OrInputParamsV2 {
  // v1 保留
  service_minutes:        { mean: number; p90: number };
  workload:               { stops_per_driver_target: number; max_minutes_per_driver: number };
  vehicle_capacity_boxes: number;

  // v2 新增
  mode:                   "auto" | "manual" | "compare";   // 預設 auto
  planning_horizon:       "daily" | "quarterly";           // 預設 quarterly
  use_recovered_weights:  boolean;                          // 預設 true
  strategic?:             StrategicPersonality;             // manual 才填
  tactical?:              TacticalPersonality;
  compare_set?:           Array<{ strategic: StrategicPersonality; tactical: TacticalPersonality }>;
}

export const DEFAULT_AUTO_INPUT: OrInputParamsV2 = {
  service_minutes:        { mean: 10, p90: 14 },
  workload:               { stops_per_driver_target: 28, max_minutes_per_driver: 480 },
  vehicle_capacity_boxes: 60,
  mode:                   "auto",
  planning_horizon:       "quarterly",
  use_recovered_weights:  true
};

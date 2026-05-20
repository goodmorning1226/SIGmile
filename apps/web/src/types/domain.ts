// =========================================================
// 與 Supabase enum / 主要 table shape 對齊的領域型別
// 後續若要嚴格型別檢查可改 `supabase gen types typescript`
// 產生到 ./db.ts，這份檔案只需匯入 enum 即可。
// =========================================================

export type UserRole         = "manager" | "driver";
export type PeriodStatus     = "draft" | "active" | "archived";
export type RoutePlanStatus  = "draft" | "published" | "archived";
export type RoutePlanSource  = "manual" | "or_mock" | "or_engine" | "ai_suggested";
export type TaskStatus       = "pending" | "in_progress" | "completed" | "cancelled";
export type TaskStopStatus   = "pending" | "navigating" | "arrived" | "completed" | "failed" | "skipped";
export type JobStatus        = "pending" | "running" | "completed" | "failed";
export type UrgentStatus     = "pending" | "assigned" | "completed" | "cancelled";
export type StopType         = "convenience_store" | "supermarket" | "warehouse" | "other";

// ---------- Phase 2 OR-aligned ----------
export type ShiftType        = "day" | "night";
export type TemperatureType  = "frozen" | "chilled" | "mixed" | "ambient";
export type TripIndex        = 1 | 2;

export const SHIFT_LABEL: Record<ShiftType, string> = {
  day:   "日班",
  night: "夜班"
};
export const TEMP_LABEL: Record<TemperatureType, string> = {
  frozen:  "冷凍",
  chilled: "冷藏",
  mixed:   "多溫層",
  ambient: "常溫"
};

// 「分群」概念（OR 跑完後產生，主管可重命名/合併/拆分）
export interface DriverCluster {
  id: string;
  route_plan_id: string;
  cluster_name: string;
  sequence: number;
  estimated_total_minutes: number | null;
  estimated_total_distance_meters: number | null;
  estimated_total_volume: number | null;
  assigned_driver_id: string | null;
  required_shift: ShiftType | null;
  required_temperature: TemperatureType | null;
}

// ---------- Dashboard KPI ----------
export interface DashboardKpi {
  completion_rate: number;
  store_arrival_rate: number;
  on_time_rate: number;
  uploaded_store_count: number;
  arrived_store_count: number;
  on_time_store_count: number;
  total_stop_count: number;
  in_progress_driver_count: number;
  exception_count: number;
  snapshot_date: string;
}

// ---------- AI ----------
export interface AiAnalysisResult {
  summary: string;
  risk_level: "low" | "medium" | "high";
  delayed_routes: Array<{
    driver_name: string;
    route_name: string;
    delayed_stops: number;
    estimated_delay_minutes: number;
  }>;
  recommended_actions: string[];
  generated_at: string;
}

export interface AiParameterPrediction {
  prediction_type: string;
  output_parameters: Record<string, unknown>;
  confidence_score: number | null;
}

// ---------- OR ----------
//  OR output 一律 JSONB；下方是「對齊 MTVRP 模型」的 v2 形狀，
//  支援一日二配 (trip_index) 與 cluster 概念。
//  未來換真實 Python OR engine 時，產生符合此 schema 的 JSONB 即可。
export interface OrOutputPlanV2 {
  engine: string;                  // 'mock' | 'pyomo' | ...
  engine_version: string;
  generated_at: string;
  // OR 內部最佳化用的（UI 不顯示）
  objective_value?: number;
  // 主管會看到的彙總
  summary: {
    total_clusters: number;
    total_stops: number;
    total_estimated_minutes: number;
    total_estimated_distance_meters?: number;
    drivers_dispatched: number;   // u_p = 1 的人數
  };
  clusters: Array<{
    cluster_name: string;          // 「林口/龜山 A 組」
    sequence: number;
    required_shift?: ShiftType;
    required_temperature?: TemperatureType;
    estimated_total_minutes: number;
    estimated_total_distance_meters: number;
    estimated_total_volume: number;
    // OR 建議的指派 driver（主管可改）
    suggested_driver_id?: string | null;
    trips: Array<{
      trip_index: TripIndex;
      stops: Array<{
        stop_id: string;
        stop_order: number;        // 在這個 trip 內的順序
        estimated_arrival_time: string;     // 'HH:MM'
        estimated_service_minutes: number;
        estimated_volume?: number;
      }>;
    }>;
  }>;
  unassigned_stops?: string[];     // 因容量/時窗/溫層無法被任何 cluster 涵蓋的 stop_id
  metadata?: Record<string, unknown>;
}

// 舊 v1 保留（不要立刻 break 舊資料）
export interface OrOutputPlanV1 {
  engine: "mock";
  generated_at: string;
  drivers: Array<{
    driver_id: string;
    route_name: string;
    estimated_total_minutes: number;
    estimated_total_distance_meters: number;
    stops: Array<{
      stop_id: string;
      stop_order: number;
      estimated_arrival_time: string;
      estimated_service_minutes: number;
    }>;
  }>;
}

// OR 輸入 (input_parameters)
export interface OrInputParametersV2 {
  // 權重（α 配送時間、β 派工人數）— γ 加班 UI 不顯示，後端寫死
  weights: {
    alpha_travel_time: number;     // α
    beta_dispatch:     number;     // β
  };
  // 車輛容量 / 工時上限 / 服務時間估算（從 stops 主檔抓，這裡是 fallback）
  defaults: {
    vehicle_capacity_boxes: number;
    max_work_minutes:       number;
    service_minutes_default: number;
  };
  // 任意延伸（未來 OR engine 想吃什麼欄位都丟這）
  extra?: Record<string, unknown>;
}

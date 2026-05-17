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
//  OR output 一律 JSONB；下方僅是 MVP mock 的形狀，未來換真實 engine 不影響 schema。
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
      estimated_arrival_time: string;       // 'HH:MM'
      estimated_service_minutes: number;
    }>;
  }>;
}

import "server-only";
import type { AiAnalysisResult } from "@/types/domain";

/**
 * AI 服務介面。MVP 全部 mock。
 *
 * 未來替換點：
 *   - 換成 RealAIService 內呼叫 Anthropic / OpenAI，input/output 仍維持 JSON 形狀。
 *   - 因為寫進 DB 的 `output_analysis`、`output_parameters`、`ai_assignment_suggestion`
 *     都是 jsonb，schema 不需改變。
 */
export interface AnalyzeDeliveryStatusInput {
  scope: "today_overview" | "driver_detail" | "period";
  scope_ref_id?: string;
  // 任意上下文資料，呼叫端決定要丟什麼
  context?: Record<string, unknown>;
}

export interface PredictPlanningParametersInput {
  planning_period_id: string;
  prediction_type: "service_minutes" | "stop_demand" | "eta" | "workload" | "risk";
  historic_data?: Record<string, unknown>;
}

export interface SuggestUrgentShipmentAssignmentInput {
  urgent_shipment_id: string;
  candidate_driver_ids: string[];
}

export interface IAIService {
  analyzeDeliveryStatus(input: AnalyzeDeliveryStatusInput): Promise<AiAnalysisResult>;
  predictPlanningParameters(input: PredictPlanningParametersInput): Promise<{
    output_parameters: Record<string, unknown>;
    confidence_score: number;
    model_version: string;
  }>;
  suggestUrgentShipmentAssignment(input: SuggestUrgentShipmentAssignmentInput): Promise<{
    ranked: Array<{ driver_id: string; score: number; reason: string }>;
    model_version: string;
  }>;
}

type DelayedRouteInput = AiAnalysisResult["delayed_routes"][number];

const ACTIONS_BY_RISK: Record<AiAnalysisResult["risk_level"], string[]> = {
  low: [
    "目前無顯著延誤，維持現行排程即可",
    "可提早於 11:00 前確認下午追加配送需求"
  ],
  medium: [
    "建議重點關注延誤超過 15 分鐘的路線",
    "提早通知客戶可能延遲抵達",
    "若異常數續增，請啟動 OR 重排或調度後備物流士"
  ],
  high: [
    "立刻聯繫延誤超過 30 分鐘路線的物流士確認狀況",
    "派遣後備物流士支援延誤最嚴重的路線",
    "通知主要受影響門市調整收貨時間",
    "考慮觸發 OR 重排，把急件改派給空閒物流士"
  ]
};

export class MockAIService implements IAIService {
  async analyzeDeliveryStatus(input: AnalyzeDeliveryStatusInput): Promise<AiAnalysisResult> {
    const ctx = (input.context ?? {}) as Record<string, unknown>;
    const completion = Number(ctx.completion_rate ?? 0);
    const onTime     = Number(ctx.on_time_rate ?? 0);
    const exceptions = Number(ctx.exception_count ?? 0);

    // delayed_routes 可由呼叫端在 context.delayed_routes 帶入（由 API route 查 DB 後組好）。
    // 沒帶就回空陣列，**絕不寫死假資料**。
    const delayed: DelayedRouteInput[] = Array.isArray(ctx.delayed_routes)
      ? (ctx.delayed_routes as DelayedRouteInput[])
      : [];

    const risk: AiAnalysisResult["risk_level"] =
      completion < 0.5 || onTime < 0.6 || exceptions >= 3 || delayed.length >= 2 ? "high"
      : completion < 0.8 || onTime < 0.85 || exceptions >= 1 || delayed.length >= 1 ? "medium"
      : "low";

    return {
      summary:
        `今日完成率 ${(completion * 100).toFixed(1)}%、準時率 ${(onTime * 100).toFixed(1)}%，` +
        `共回報 ${exceptions} 件異常、${delayed.length} 條延誤路線。整體風險為 ${risk}。`,
      risk_level: risk,
      delayed_routes: delayed,
      recommended_actions: ACTIONS_BY_RISK[risk],
      generated_at: new Date().toISOString()
    };
  }

  async predictPlanningParameters(input: PredictPlanningParametersInput) {
    // 隨 prediction_type 給不同 mock 內容；型別保留彈性
    const map: Record<string, Record<string, unknown>> = {
      service_minutes: { mean: 10, p90: 14, by_stop_type: { convenience_store: 10 } },
      stop_demand:     { mean_boxes: 8, peak_day: "Friday" },
      eta:             { avg_travel_minutes_between_stops: 12 },
      workload:        { stops_per_driver_target: 28 },
      risk:            { high_risk_zones: ["板橋"], delay_probability: 0.18 }
    };
    return {
      output_parameters: map[input.prediction_type] ?? { note: "mock" },
      confidence_score: 0.78,
      model_version: "mock-v0"
    };
  }

  async suggestUrgentShipmentAssignment(input: SuggestUrgentShipmentAssignmentInput) {
    const ranked = input.candidate_driver_ids.slice(0, 3).map((id, idx) => ({
      driver_id: id,
      score: Number((0.9 - idx * 0.15).toFixed(2)),
      reason: idx === 0 ? "最接近且尚有空檔" : idx === 1 ? "次近，路線相近" : "備援"
    }));
    return { ranked, model_version: "mock-v0" };
  }
}

export const aiService: IAIService = new MockAIService();

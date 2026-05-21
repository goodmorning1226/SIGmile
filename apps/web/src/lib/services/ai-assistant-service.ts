import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { generateMockUrgentShipments } from "@/lib/services/urgent-dispatch-service";
import { planReroute, getTodaySnapshot } from "@/lib/services/emergency-reroute-service";
import { buildInsight } from "@/lib/services/ai-insights-service";

/**
 * AI 助理服務 — 主管用人話描述情況，AI 解讀成「可執行的行動卡」。
 *
 * 切真 LLM (Claude / GPT) 只要改 `classifyIntent` 與 `extractSlots`：
 *   把 prompt + JSON schema 丟給 LLM，它回 { intent, slots } 即相容。
 *
 * 為什麼用 rule-based:
 *   - 可解釋: 主管問「為什麼觸發了重派」→ AI 回「因為你的訊息含『翹班』+ 動詞『剩』+ 數字 12」
 *   - 0 成本 / 0 latency / 0 外部依賴
 *   - Phase 1 切 LLM 時 schema 不變
 */

// ─────────────────────────────────────────────────────────────
// 意圖類型 — 對應「主管會問的問題」7 個情境
// ─────────────────────────────────────────────────────────────
export type AssistantIntent =
  | "driver_down"        // 物流士翹班 / 出事 / 車壞
  | "urgent_order"       // 急件 / VIP 加單
  | "delay_recovery"     // 延誤應變（塞車 / 下雨 / 進度落後）
  | "quality_issue"      // 客訴 / 異常回報處理
  | "status_query"       // 「現在情況如何」狀況查詢
  | "scenario_planning"  // 「如果...怎麼辦」假設情境
  | "general_help";      // fallback

export interface ExtractedSlots {
  driver_name?: string;       // "D02" / "李大華"
  driver_id?: string;          // resolved
  stop_count?: number;         // "12 站"
  delay_minutes?: number;      // "晚 30 分"
  affected_count?: number;     // 「3 個客戶」
  time_horizon?: string;       // "下午" / "傍晚"
  severity?: "low" | "medium" | "high";
}

export interface ActionCard {
  /** 主管按下後要打的 API */
  action_type:
    | "trigger_emergency_reroute"
    | "create_urgent_shipments"
    | "run_deep_insight"
    | "view_dashboard"
    | "open_emergency_page"
    | "open_urgent_page"
    | "log_escalation"
    | "no_op_explain";
  title: string;
  description: string;
  /** 信心分 0..1 — 主管可挑高分的優先做 */
  confidence: number;
  /** 影響範圍預覽：例 "12 個 stops × 5 位 driver" */
  impact_preview: string;
  /** action_type 對應的 payload — 主管按執行時透傳給 API */
  payload?: Record<string, unknown>;
  /** P0 / P1 / P2 */
  priority: "p0" | "p1" | "p2";
  /** 按鈕文字（cta） */
  cta_label: string;
}

export interface AssistantReply {
  /** AI 對主管訊息的解讀（人話） */
  interpretation: string;
  intent: AssistantIntent;
  slots: ExtractedSlots;
  /** 建議的行動卡（0..N 張） */
  actions: ActionCard[];
  /** 補充說明 / next steps（不需要按鈕的純文字建議） */
  notes: string[];
  /** AI 整體信心 */
  confidence: number;
}

export interface ExecuteResult {
  ok: boolean;
  /** 給 UI 回填的人話結果 */
  message: string;
  /** 可選的 redirect path */
  redirect_to?: string;
  /** 執行細節（JSON，UI 可選擇展示） */
  detail?: unknown;
}

// ─────────────────────────────────────────────────────────────
// 1. 意圖分類 — 規則 + 關鍵字
// ─────────────────────────────────────────────────────────────
const INTENT_PATTERNS: Array<{
  intent: AssistantIntent;
  keywords: string[];
  /** 觸發加分（多重命中 → 高信心） */
  weight: number;
}> = [
  {
    intent: "driver_down",
    keywords: [
      "翹班", "翘班", "請假", "请假", "生病", "車壞", "车坏", "拋錨", "抛锚",
      "車禍", "车祸", "出事", "意外", "受傷", "受伤",
      "突然不能跑", "跑不了", "送不完", "送不动", "沒到", "没到", "曠職", "旷职"
    ],
    weight: 1.0
  },
  {
    intent: "urgent_order",
    keywords: [
      "急件", "加單", "加单", "VIP", "vip", "臨時", "临时", "插單", "插单",
      "急送", "馬上", "马上", "立刻", "緊急訂", "紧急订", "業務追加", "业务追加",
      "客戶催", "客户催", "補件", "补件"
    ],
    weight: 1.0
  },
  {
    intent: "delay_recovery",
    keywords: [
      "下雨", "塞車", "塞车", "車陣", "车阵", "延誤", "延误", "落後", "落后",
      "慢了", "進度", "进度", "趕不上", "赶不上", "做不完", "天氣", "天气",
      "颱風", "台风", "事故"
    ],
    weight: 1.0
  },
  {
    intent: "quality_issue",
    keywords: [
      "客訴", "客诉", "投訴", "投诉", "抱怨", "異常", "异常", "破損", "破损",
      "溫度", "温度", "凍壞", "冻坏", "融化", "退貨", "退货", "申訴", "申诉"
    ],
    weight: 1.0
  },
  {
    intent: "status_query",
    keywords: [
      "現在", "现在", "目前", "狀況", "状况", "進度", "进度", "怎麼樣", "怎么样",
      "如何", "幾%", "几%", "完成多少", "誰", "谁", "哪些", "看一下", "看看"
    ],
    weight: 0.8
  },
  {
    intent: "scenario_planning",
    keywords: [
      "如果", "假設", "假设", "要是", "萬一", "万一", "推演", "模擬", "模拟",
      "預估", "预估", "預測", "预测", "下星期", "下週", "下周"
    ],
    weight: 0.7
  }
];

function classifyIntent(message: string): { intent: AssistantIntent; raw_score: number } {
  const text = message.toLowerCase();
  let best: AssistantIntent = "general_help";
  let bestScore = 0;
  for (const p of INTENT_PATTERNS) {
    let score = 0;
    let hits = 0;
    for (const kw of p.keywords) {
      if (text.includes(kw.toLowerCase())) {
        hits++;
        score += p.weight;
      }
    }
    if (hits > 0 && score > bestScore) {
      bestScore = score;
      best = p.intent;
    }
  }
  return { intent: best, raw_score: bestScore };
}

// ─────────────────────────────────────────────────────────────
// 2. 槽位提取
// ─────────────────────────────────────────────────────────────
async function extractSlots(message: string): Promise<ExtractedSlots> {
  const slots: ExtractedSlots = {};

  // driver_name: D01..D99 / 員工編號模式 / 姓名（從 DB 反查）
  const driverCodeMatch = message.match(/([Dd]\d{1,3})/);
  if (driverCodeMatch) slots.driver_name = driverCodeMatch[1].toUpperCase();

  // 試從 DB 反查名字 → driver_id
  const admin = createSupabaseAdminClient();
  if (slots.driver_name) {
    const { data: d } = await admin
      .from("profiles")
      .select("id, full_name, employee_code")
      .eq("role", "driver")
      .or(`employee_code.eq.${slots.driver_name},full_name.ilike.%${slots.driver_name}%`)
      .limit(1)
      .maybeSingle<{ id: string; full_name: string; employee_code: string | null }>();
    if (d) {
      slots.driver_id = d.id;
      slots.driver_name = d.full_name;
    }
  }

  // 數字 + 「站」
  const stopMatch = message.match(/(\d+)\s*[個个]?\s*[站点点]/);
  if (stopMatch) slots.stop_count = parseInt(stopMatch[1], 10);

  // 延誤分鐘
  const delayMatch = message.match(/(?:延誤|延误|遲|迟|慢)\s*(\d+)\s*分/);
  if (delayMatch) slots.delay_minutes = parseInt(delayMatch[1], 10);

  // 影響客戶數
  const affectedMatch = message.match(/(\d+)\s*[個个]?\s*(?:客戶|客户|門市|门市|店)/);
  if (affectedMatch) slots.affected_count = parseInt(affectedMatch[1], 10);

  // 時段
  if (/(上午|早上|早班)/.test(message)) slots.time_horizon = "上午";
  else if (/(下午|傍晚|晚班|晚上)/.test(message)) slots.time_horizon = "下午";
  else if (/(中午|午餐)/.test(message)) slots.time_horizon = "中午";

  // 嚴重度
  if (/(緊急|紧急|火燒|火烧|大事|嚴重|严重|完蛋)/.test(message)) slots.severity = "high";
  else if (/(注意|麻煩|麻烦|小問題|小问题)/.test(message)) slots.severity = "medium";

  return slots;
}

// ─────────────────────────────────────────────────────────────
// 3. 行動規劃 — intent + slots → ActionCard[]
// ─────────────────────────────────────────────────────────────
async function planActions(intent: AssistantIntent, slots: ExtractedSlots): Promise<ActionCard[]> {
  const cards: ActionCard[] = [];

  switch (intent) {
    case "driver_down": {
      if (slots.driver_id) {
        cards.push({
          action_type: "trigger_emergency_reroute",
          title: `啟動 AI 重派 — ${slots.driver_name}`,
          description: `把 ${slots.driver_name} 剩餘 pending stops 用 cheapest-insertion 演算法重派給其他物流士`,
          confidence: 0.92,
          impact_preview: slots.stop_count
            ? `預計搬遷約 ${slots.stop_count} 站，影響其他 ~${Math.max(2, Math.ceil(slots.stop_count / 4))} 位 driver`
            : `將算出影響範圍`,
          payload: { down_driver_id: slots.driver_id },
          priority: "p0",
          cta_label: "預覽重派方案"
        });
      }
      cards.push({
        action_type: "open_emergency_page",
        title: "打開緊急應變看板",
        description: "看今日所有物流士的進度，手動選擇要應變的物流士",
        confidence: 0.85,
        impact_preview: "只是導頁，不會寫資料",
        priority: "p1",
        cta_label: "前往緊急應變"
      });
      cards.push({
        action_type: "log_escalation",
        title: `記錄 escalation — ${slots.driver_name ?? "物流士"} 缺勤`
        ,
        description: "寫入 ai_analysis_requests 留存記錄，方便事後追蹤",
        confidence: 0.7,
        impact_preview: "只新增 1 筆 audit log",
        payload: { kind: "driver_down", driver_name: slots.driver_name ?? null, stop_count: slots.stop_count ?? null },
        priority: "p2",
        cta_label: "記一筆"
      });
      break;
    }

    case "urgent_order": {
      const count = slots.affected_count ?? 5;
      cards.push({
        action_type: "create_urgent_shipments",
        title: `產生 ${count} 筆急件 → AI 派遣`,
        description: `從 stops 主檔抽 ${count} 筆當急件，每筆 AI 算最佳物流士`,
        confidence: 0.88,
        impact_preview: `${count} 筆 in-memory 急件 — 主管選哪筆才會真寫進 delivery_task_stops`,
        payload: { count },
        priority: "p1",
        cta_label: `產生 ${count} 筆 mock 急件`
      });
      cards.push({
        action_type: "open_urgent_page",
        title: "打開急件派遣看板",
        description: "查看現有急件 + AI 派遣建議",
        confidence: 0.85,
        impact_preview: "只是導頁",
        priority: "p2",
        cta_label: "前往急件派遣"
      });
      break;
    }

    case "delay_recovery": {
      cards.push({
        action_type: "run_deep_insight",
        title: "立刻跑 AI 深度分析",
        description: "找出哪小時崩盤、哪位 driver 落後同儕、是否有 outlier",
        confidence: 0.9,
        impact_preview: "只讀資料、寫一筆 ai_analysis_requests",
        priority: "p1",
        cta_label: "跑深度分析"
      });
      cards.push({
        action_type: "open_emergency_page",
        title: "預覽是否需重派最慢路線",
        description: "若有路線延誤 ≥ 30 分，可考慮把它的 pending stops 分一部分給其他人",
        confidence: 0.75,
        impact_preview: "只是導頁",
        priority: "p1",
        cta_label: "前往緊急應變"
      });
      cards.push({
        action_type: "log_escalation",
        title: "記錄延誤事件",
        description: "留 audit log，便於跟客戶解釋",
        confidence: 0.7,
        impact_preview: "1 筆 log",
        payload: { kind: "delay_event", note: `延誤 ${slots.delay_minutes ?? "?"} 分 / 時段 ${slots.time_horizon ?? "?"}` },
        priority: "p2",
        cta_label: "記一筆"
      });
      break;
    }

    case "quality_issue": {
      cards.push({
        action_type: "run_deep_insight",
        title: "查門市異常熱點",
        description: "AI 找出過去 7 天累積 ≥ 2 次異常的門市清單 + 建議",
        confidence: 0.9,
        impact_preview: "只讀資料",
        priority: "p1",
        cta_label: "看異常熱點"
      });
      cards.push({
        action_type: "log_escalation",
        title: "登記客訴 escalation",
        description: "AI audit log 留客訴記錄，方便事後客服回覆",
        confidence: 0.78,
        impact_preview: "1 筆 log",
        payload: { kind: "quality_issue", affected: slots.affected_count ?? null },
        priority: "p2",
        cta_label: "記一筆"
      });
      break;
    }

    case "status_query": {
      cards.push({
        action_type: "run_deep_insight",
        title: "即時跑 AI 深度分析",
        description: "整體 KPI + 時段瓶頸 + 物流士 outlier + 門市熱點 + 延誤路線",
        confidence: 0.95,
        impact_preview: "全部從 DB 即時算",
        priority: "p1",
        cta_label: "現在跑"
      });
      cards.push({
        action_type: "view_dashboard",
        title: "看 dashboard",
        description: "6 個 KPI cards + 每小時完成進度 + 物流士排行",
        confidence: 0.8,
        impact_preview: "只是導頁",
        priority: "p2",
        cta_label: "前往總覽"
      });
      break;
    }

    case "scenario_planning": {
      cards.push({
        action_type: "no_op_explain",
        title: "假設情境推演 — 尚未實作",
        description: "Phase 2 會接 LLM 做 what-if 模擬。目前可用「OR 演算法測試」頁手動跑場景。",
        confidence: 0.4,
        impact_preview: "—",
        priority: "p2",
        cta_label: "我知道了"
      });
      cards.push({
        action_type: "run_deep_insight",
        title: "看當前實際情況",
        description: "推演的 baseline 從現況開始，AI 跑一次幫你蓋當前快照",
        confidence: 0.6,
        impact_preview: "—",
        priority: "p2",
        cta_label: "跑分析"
      });
      break;
    }

    case "general_help":
    default: {
      cards.push({
        action_type: "no_op_explain",
        title: "我能幫你的事",
        description: "1️⃣ 物流士翹班 / 出事 → 一鍵 AI 重派\n" +
          "2️⃣ VIP 急件加單 → AI 推薦最適物流士\n" +
          "3️⃣ 延誤 / 客訴 → 跑深度分析找 root cause\n" +
          "4️⃣ 現在情況如何 → 一鍵 AI 快照\n" +
          "試試在輸入框輸入：「D02 翹班，剩 12 站怎麼辦」",
        confidence: 1.0,
        impact_preview: "—",
        priority: "p2",
        cta_label: "我知道了"
      });
      cards.push({
        action_type: "run_deep_insight",
        title: "AI 深度分析（任何時候都有用）",
        description: "整體 KPI + 瓶頸 + outlier + 熱點",
        confidence: 0.85,
        impact_preview: "—",
        priority: "p2",
        cta_label: "跑一次"
      });
      break;
    }
  }

  return cards;
}

// ─────────────────────────────────────────────────────────────
// 4. 主入口 — ask
// ─────────────────────────────────────────────────────────────
export async function askAssistant(message: string): Promise<AssistantReply> {
  const cls = classifyIntent(message);
  const slots = await extractSlots(message);
  const actions = await planActions(cls.intent, slots);

  // 解讀文字（人話）
  const interpretParts: string[] = [];
  switch (cls.intent) {
    case "driver_down":
      interpretParts.push(`偵測到「物流士無法繼續配送」情境`);
      if (slots.driver_name) interpretParts.push(`目標：${slots.driver_name}${slots.driver_id ? "（已對應到資料庫）" : "（資料庫找不到對應，需手動指定）"}`);
      if (slots.stop_count) interpretParts.push(`影響站數：${slots.stop_count}`);
      break;
    case "urgent_order":
      interpretParts.push(`偵測到「急件 / 臨時加單」情境`);
      if (slots.affected_count) interpretParts.push(`規模：${slots.affected_count} 件`);
      break;
    case "delay_recovery":
      interpretParts.push(`偵測到「延誤 / 進度落後」情境`);
      if (slots.delay_minutes) interpretParts.push(`延誤幅度：${slots.delay_minutes} 分`);
      if (slots.time_horizon) interpretParts.push(`時段：${slots.time_horizon}`);
      break;
    case "quality_issue":
      interpretParts.push(`偵測到「客訴 / 品質異常」情境`);
      if (slots.affected_count) interpretParts.push(`影響規模：${slots.affected_count} 件`);
      break;
    case "status_query":
      interpretParts.push(`偵測到「現況查詢」`);
      break;
    case "scenario_planning":
      interpretParts.push(`偵測到「假設情境推演」`);
      break;
    case "general_help":
    default:
      interpretParts.push(`沒辨識到明確情境 — 切到通用幫助模式`);
      break;
  }

  // 信心: 基於命中關鍵字數 + 槽位數
  const slotCount = Object.values(slots).filter((v) => v !== undefined && v !== null).length;
  const confidence = Math.min(0.99,
    cls.intent === "general_help" ? 0.4 :
      (Math.min(cls.raw_score, 3) / 3) * 0.6 + (Math.min(slotCount, 3) / 3) * 0.4
  );

  const notes: string[] = [];
  if (cls.intent === "driver_down" && !slots.driver_id && !slots.driver_name) {
    notes.push("找不到具體物流士編號，可改用「前往緊急應變」手動指定");
  }
  if (cls.intent === "driver_down" && slots.driver_name && !slots.driver_id) {
    notes.push(`「${slots.driver_name}」沒在資料庫找到，可能是測試環境沒種子資料`);
  }
  if (confidence < 0.5) {
    notes.push("AI 信心較低，建議主管手動確認或補充情境資訊再問一次");
  }

  return {
    interpretation: interpretParts.join("。 "),
    intent: cls.intent,
    slots,
    actions,
    notes,
    confidence
  };
}

// ─────────────────────────────────────────────────────────────
// 5. 執行 — 主管按行動卡上的按鈕後，這裡是落地點
// ─────────────────────────────────────────────────────────────
export async function executeAction(
  action: { action_type: ActionCard["action_type"]; payload?: Record<string, unknown> },
  context: { user_id: string | null }
): Promise<ExecuteResult> {
  switch (action.action_type) {
    case "trigger_emergency_reroute": {
      const driverId = action.payload?.down_driver_id as string | undefined;
      if (!driverId) return { ok: false, message: "缺 down_driver_id" };
      const plan = await planReroute({ down_driver_id: driverId });
      return {
        ok: true,
        message: `已計算重派方案：${plan.reassigned.length} 站重派、` +
          `分散到 ${plan.summary.distributed_to_drivers} 位 driver、` +
          `總繞路 +${plan.summary.total_delta_km} km、信心 ${(plan.summary.confidence * 100).toFixed(0)}%。` +
          `${plan.unassignable.length > 0 ? `⚠️ ${plan.unassignable.length} 個無人可接。` : ""}` +
          `主管確認請到「緊急應變」頁。`,
        redirect_to: "/emergency",
        detail: plan
      };
    }

    case "create_urgent_shipments": {
      const count = Number(action.payload?.count ?? 5);
      const items = await generateMockUrgentShipments({ count });
      return {
        ok: true,
        message: `已產生 ${items.length} 筆急件。請到「急件派遣」頁逐筆按 AI 派遣建議。`,
        redirect_to: "/urgent",
        detail: { count: items.length, ids: items.map((i) => i.id) }
      };
    }

    case "run_deep_insight": {
      const insight = await buildInsight({});
      // 寫進 ai_analysis_requests 留歷史
      const admin = createSupabaseAdminClient();
      await admin.from("ai_analysis_requests").insert({
        requested_by: context.user_id,
        scope: "today_overview",
        status: "completed",
        model_version: "assistant-insight-v1",
        input_snapshot: { triggered_by: "ai_assistant" },
        output_analysis: {
          summary: insight.headline,
          risk_level: insight.risk_level,
          delayed_routes: insight.delayed_routes,
          recommended_actions: insight.actions.map((a) => a.text),
          generated_at: insight.generated_at,
          deep_insight: insight
        },
        completed_at: new Date().toISOString()
      });
      return {
        ok: true,
        message: `AI 分析完成。${insight.headline}`,
        redirect_to: "/insights",
        detail: {
          risk_level: insight.risk_level,
          completion_rate: insight.kpi.completion_rate,
          on_time_rate: insight.kpi.on_time_rate,
          delayed_count: insight.kpi.delayed_stop_count,
          driver_outliers: insight.driver_outliers.length,
          problem_stops: insight.problem_stops.length
        }
      };
    }

    case "view_dashboard":
      return { ok: true, message: "前往今日總覽", redirect_to: "/dashboard" };

    case "open_emergency_page":
      return { ok: true, message: "前往緊急應變", redirect_to: "/emergency" };

    case "open_urgent_page":
      return { ok: true, message: "前往急件派遣", redirect_to: "/urgent" };

    case "log_escalation": {
      const admin = createSupabaseAdminClient();
      await admin.from("ai_analysis_requests").insert({
        requested_by: context.user_id,
        scope: "today_overview",
        status: "completed",
        model_version: "assistant-escalation-v1",
        input_snapshot: { kind: "escalation", payload: action.payload ?? {} },
        output_analysis: {
          summary: `AI 助理 escalation：${JSON.stringify(action.payload ?? {})}`,
          risk_level: "medium",
          delayed_routes: [],
          recommended_actions: ["人工後續追蹤"],
          generated_at: new Date().toISOString()
        },
        completed_at: new Date().toISOString()
      });
      return { ok: true, message: "已記入 audit log (ai_analysis_requests 表)" };
    }

    case "no_op_explain":
      return { ok: true, message: "OK，沒有要執行的動作。" };

    default:
      return { ok: false, message: `未知的 action_type: ${action.action_type}` };
  }
}

// ─────────────────────────────────────────────────────────────
// 6. 快速場景模板 — UI 用
// ─────────────────────────────────────────────────────────────
export const QUICK_SCENARIOS: Array<{
  emoji: string;
  label: string;
  template: string;
}> = [
  { emoji: "🚨", label: "物流士翹班", template: "D02 突然不能跑了，他剩 12 站怎麼辦？" },
  { emoji: "⚡", label: "VIP 急件", template: "VIP 客戶剛打電話來，有 3 件急件需要今天送到" },
  { emoji: "🌧️", label: "突發塞車", template: "下午下雨大塞車，車隊進度落後 30 分，怎麼追？" },
  { emoji: "❄️", label: "冷凍異常", template: "有 1 個客戶反映凍品融化了，怎麼處理？" },
  { emoji: "📊", label: "現況查詢", template: "現在配送狀況怎麼樣？哪些路線有問題？" },
  { emoji: "🤔", label: "假設推演", template: "假設明天有 2 個物流士請假，我們撐得住嗎？" }
];

// 預先把 getTodaySnapshot 暴露（雖然這裡沒直接用，但讓 future LLM tool-use 接得到）
export { getTodaySnapshot };

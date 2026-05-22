# OR 路線規劃設計文件 v2

> SIGmile 物流配送系統 — Operations Research 路線生成模組
> v2 · 2026-05-19 · 對應分支 `feat/tomtom-routes-api`
> 取代點: [apps/web/src/lib/services/or-planning-service.ts](../apps/web/src/lib/services/or-planning-service.ts)
> v2 變更: 加入「戰略層 + 學歷史 + 自動駕駛 + 可解釋性」四個新層；原 14 人格降為戰術層菜單

---

## 1. Context — 行業底層邏輯

**業界痛點**（老闆原話 + 業界共識）：

- **排班師斷層**：老師傅平均年資 15+ 年，新人 3 年才上手，產業普遍找不到接班人。
- **歷史排班成效不錯但黑盒**：老師傅的派工、序列、跨季調整全憑經驗，沒人寫得出公式。
- **季度 (quarterly) 視角**：實務是季度綁定 driver-route，不是每日重排（D0001 固定跑 R1215 一整季，門市/車輛/路線三方都熟）。
- **一鍵生成的剛需**：缺工，沒人有 30 分鐘調 OR 參數，要的是「按下去就出方案 + 比歷史好」。

**結論**：OR 不是取代排班師，是**把排班師的隱性知識顯性化**。歷史路線是 ground truth label，OR 的工作是 (a) 從歷史 recover 隱性權重 (b) 在新需求 / 缺工 / 急件 情境下用同套權重外推 (c) 同時找出比歷史更優的局部改善點。

**v1 設計問題**：當時把 14 種人格丟給主管自己挑，這預設「主管會挑 OR」— 但老闆要的是「主管按一個鈕」。v1 文件保留為**進階 / 對照模式**，預設改成自動駕駛。

---

## 2. 頂層設計 — 五層架構閉環

```
            ┌─────────────────────────────────────────┐
  歷史路線  │  ① 學歷史層 (Imitation / Inverse OR)    │
  02+03 表 →│   inverse-VRP 從歷史 recover 隱性權重   │
            └────────────────────┬────────────────────┘
                                 ↓ weight_vector + driver_skill_profile
            ┌─────────────────────────────────────────┐
            │  ② 戰略層 (Strategic, 季度)              │
   缺工/    →│   assignment problem: 誰跑哪片         │
   新人/   ←│   set-partitioning: 切平衡 beat        │
   配額      └────────────────────┬────────────────────┘
                                 ↓ driver × stops 綁定 (季度有效)
            ┌─────────────────────────────────────────┐
            │  ③ 戰術層 (Tactical, 日)                 │
            │   原 14 人格菜單 — 給定 stops 求順序     │
            └────────────────────┬────────────────────┘
                                 ↓ daily routes
            ┌─────────────────────────────────────────┐
            │  ④ 自動駕駛層 (Auto-pilot meta-policy)   │
            │   規則決定 ②③ 各挑哪個算法 — 主管不用選 │
            └────────────────────┬────────────────────┘
                                 ↓ output_plan + reasoning
            ┌─────────────────────────────────────────┐
            │  ⑤ 解釋層 (Explainability)              │
            │   「我比歷史短 8%、準時 +2pp」+ 順序原因 │
            └─────────────────────────────────────────┘
```

> 對齊一下：v1 只做了 ③，v2 補齊 ①②④⑤，這才是閉環。

---

## 3. 資料映射 — Excel → OR Inputs


| Excel sheet         | 角色                                         | 給哪一層用               |
| ------------------- | -------------------------------------------- | ------------------------ |
| 01_配送據點資料     | depot 起終點、溫層白名單                     | ②③                     |
| **02_歷史路線主檔** | **labeled data — 每條 = 一次排班師決定**    | **① training set**      |
| **03_路線停靠明細** | **labeled data — stop 順序 + 實際抵達時間** | **① training set**      |
| 04_停靠點主檔       | 節點屬性: lat/lng、時間窗、貨量、溫層、車型  | ②③                     |
| 05_物流士車輛資料   | 車隊、工時、車容、溫層匹配、班別             | ②③                     |
| 06_配送績效彙總     | on-time / delay — ground truth metric       | ① 驗證 + ⑤ 對比        |
| 07_急件異常紀錄     | 插單實測延遲                                 | ③ #13 dynamic + ① 修正 |

**衍生資料 (P0 建表)**：

- `driver_skill_profile` — 從 02+03 學出來：每個 driver 的「平均偏好（短路線 / 大店多 / 早班結束）」、「實測準時率」、「歷史搭配車輛」
- `stop_geocoded` — 一次性 TomTom geocode 灌 lat/lng 進 `stops` 表
- `or_recovered_weights` — ① 跑出來的隱性權重，per DC × per shift 一行
- `distance_matrix_cache` — Haversine + TomTom 真實 matrix 兩階段 cache

---

## 4. 戰略層算法菜單 (Strategic — 季度)

> 戰略層解的是「誰固定跑哪片」— 一季只跑一次，輸出綁定 90 天。


| #  | Strategic ID             | 中文標籤       | 求解什麼                                  | 用得到的欄位                     | Solver                |
| -- | ------------------------ | -------------- | ----------------------------------------- | -------------------------------- | --------------------- |
| S1 | `strat_history_lock`     | 沿用歷史派工   | 直接複製歷史 driver-route 綁定            | 02 主檔                          | 純 SQL                |
| S2 | `strat_hungarian`        | 全局派工最佳化 | min Σ cost(driver_i, route_j)，1對1分派  | driver_skill × route_difficulty | Hungarian / Munkres   |
| S3 | `strat_set_partition`    | 切平衡 beat    | 把所有 stops 切成 N 個負荷均衡的 beat     | 04 + 05 + 06                     | OR-Tools CP-SAT       |
| S4 | `strat_multi_period_vrp` | 多週期路線     | 規劃週循環（一三五一組 / 二四六一組）     | 04.delivery_freq                 | OR-Tools PDPTW 變體   |
| S5 | `strat_quarterly_fair`   | 季度工時公平   | min σ(total_minutes per driver) 跨 90 天 | 02 + 05                          | LP + post-balance     |
| S6 | `strat_apprentice_mix`   | 學徒模式       | 新人短路線、老手難路線、配對 mentor       | driver_skill_profile.seniority   | 規則 + Hungarian 微調 |

**預設 (auto-pilot 挑)**：第一次跑用 **S2 Hungarian** + history 當 cost 函數 → 季度中間缺工切到 **S6** 學徒模式 → 大檔期切到 **S5** 工時公平。

---

## 5. 戰術層算法菜單 (Tactical — 日)

> 戰術層解的是「給定今天這幾站怎麼跑」— 每天可重算，原 v1 菜單。


| #   | Tactical ID                  | 中文標籤              | 目標函數                        | Solver                             |
| --- | ---------------------------- | --------------------- | ------------------------------- | ---------------------------------- |
| T1  | `tac_tsp_min_distance`       | 省油 / 最短里程       | min Σ d(i,j)                   | OR-Tools GLS                       |
| T2  | `tac_vrptw_min_lateness`     | 準時 / 不遲到         | min lateness + travel           | OR-Tools + Time Dim                |
| T3  | `tac_cvrp_balanced_capacity` | 分組 / 不爆載         | min Σ d s.t. capacity          | OR-Tools VRP                       |
| T4  | `tac_top_vip_first`          | VIP / 大客戶先        | max Σ priority within shift    | OR-Tools disjunction               |
| T5  | `tac_min_makespan`           | 衝刺 / 最快下班       | min max_v(route_time)           | OR-Tools span cost                 |
| T6  | `tac_min_max_workload`       | 公平 / 工時平均       | min (max−min) of duration      | OR-Tools                           |
| T7  | `tac_robust_traffic_p80`     | 塞車保險              | 同 T2，用 80% 旅行時間          | OR-Tools on percentile matrix      |
| T8  | `tac_cluster_then_tsp`       | 區域 / 一里一里跑     | KMeans → 每群 TSP              | sklearn + OR-Tools                 |
| T9  | `tac_sweep_polar`            | 掃描 (baseline)       | 極角 + 容量切點                 | 50 行純 TS                         |
| T10 | `tac_clarke_wright_savings`  | 老司機 / 順路一起送   | 合併儲值最大兩線                | 純 TS                              |
| T11 | `tac_green_eco`              | 環保 / 省油減碳       | min Σ load × dist × fuel     | OR-Tools 自訂 arc cost             |
| T12 | `tac_cx_min_wait`            | 客戶體驗 / 平均等最短 | min Σ arrival_time             | OR-Tools cumul cost                |
| T13 | `tac_dynamic_insert`         | 機動 / 急件插單       | cheapest-insertion + warm-start | OR-Tools`ReadAssignmentFromRoutes` |
| T14 | `tac_alns_best_quality`      | 最佳化 / 30s ALNS     | 任 T1–T7 + 30s budget          | pyvrp HGS-SPRINT                   |

**戰術層預設**: `tac_vrptw_min_lateness` (對應統昶體系時間窗硬性)。

---

## 6. ① 學歷史層 (Imitation / Inverse Optimization)

> 這是 v2 的靈魂 — 沒有這層，OR 永遠是「跟老師傅吵架的菜鳥」。

### 6.1 為什麼學歷史

老師傅的選擇 = 大量隱含信號的疊加（門市老闆關係、貨車迴轉半徑、紅綠燈相位、警察固定地點… OR 模型不可能全建模）。**直接 inverse 回 weight vector 是最便宜的近似**。

### 6.2 Inverse VRP — 從歷史路線 recover 隱性權重

**輸入**: 02 + 03 共 N 條歷史路線（同一 DC，過去 2 季）
**輸出**: 該 DC 的權重向量 `w = (w_distance, w_time, w_capacity, w_vip, w_balance)` ∈ ℝ⁵

**做法**（最便宜的 baseline）:

```
1. 對每條歷史路線 R_h，計算它的特徵向量 φ(R_h) = (total_dist, total_time, peak_load, vip_visits, workload_var)
2. 對每條歷史路線 R_h，跑 OR-Tools 用隨機 w 解出 R'，計算 φ(R')
3. 目標：找 w 使 R_h 在 w·φ 排序下「最像最佳解」
   等價於 structured SVM / max-margin imitation learning
4. 用 scipy.optimize.minimize 跑 ~5 分鐘收斂
```

**進階版**: 用 `vrp-inverse` 開源工具 (Chen et al. 2022) 或 IRL (MaxEntIRL)。P1 補。

**輸出寫進 `or_recovered_weights` 表**：

```sql
depot_id | shift | w_distance | w_time | w_capacity | w_vip | w_balance | trained_at | n_samples
DC001    | 夜    | 0.42       | 0.31   | 0.15       | 0.08  | 0.04      | 2026-05-19 | 87
```

### 6.3 驗證: hold-out predictive accuracy

- 切 80/20，用 80% 跑 inverse opt，20% 當 hold-out
- Metric: **Kendall-τ rank correlation** between OR predicted sequence and human sequence on hold-out
- 目標 τ ≥ 0.7（>0.5 就比 random 好）

### 6.4 用法閉環

OR-Tools `RoutingModel` 的 arc cost callback 直接吃 recovered w：

```python
arc_cost(i,j) = w_distance · dist(i,j)
              + w_time     · travel_time(i,j)
              + w_capacity · capacity_penalty(j)
              + w_vip      · (1 − priority(j))
              + w_balance  · workload_deviation_after(j)
```

> 因為信任所以簡單 — 學歷史不是要打敗老師傅，是要把他的判斷 encode 成 OR 看得懂的 weight，之後老師傅退休 / 請假，系統自動接班。

---

## 7. ④ 自動駕駛層 (Auto-pilot meta-policy)

**規則表**（v0 — 之後可上 RL agent，目前手寫規則就夠）:


| 觸發條件                 | Strategic         | Tactical           | 用 recovered weights? |
| ------------------------ | ----------------- | ------------------ | --------------------- |
| 季初新建排班 (default)   | S2 Hungarian      | T2 VRPTW           | ✅                    |
| 缺工 (driver 出勤 < 80%) | S6 Apprentice     | T6 min-max         | ✅                    |
| 大檔期 / 雙 11           | S5 Quarterly Fair | T5 Makespan        | ✅                    |
| 急件 24h 內              | (沿用)            | T13 Dynamic Insert | ✅                    |
| 主管疑慮 / 想比較        | (任意)            | T1+T2+T6+T9 並排   | ✅ + 無權重 baseline  |
| 引擎掛掉                 | S1 History Lock   | T9 Sweep           | ❌                    |

**主管視角**：

- **預設 UI** 只有一顆按鈕：「**一鍵生成本季排班**」→ 跑 S2 + T2 + recovered weights → 出方案 + 可解釋報告
- 進階開關：「比較模式」→ 展開 v1 的 14 人格選擇器

---

## 8. ⑤ 解釋層 (Explainability)

每個 OR output 附三層解釋（不是訓練 LLM 寫文案，是模板填空）：

### 8.1 對比歷史 (Headline)

```
本方案 vs 歷史 R1215：
  ✓ 總里程 -8.2%   (89km → 82km)
  ✓ 準時率 +2.4pp  (96.0% → 98.4%, 估計)
  ✓ 工時公平 σ -41%
  · 保留 73% 你慣用的相鄰站點對 (39/53 pair 一致)
```

### 8.2 順序原因 (per stop)

每個 stop 順序附 1–2 個 reason tag：

- `🌡️ 冷凍優先`：S102 排在第 3 — 因為冷凍貨物溫度損失風險
- `🕒 時間窗`：S087 排在第 7 — 18:00–21:00 才能配送，提早抵達會等
- `🛣️ 順路`：S134 排在第 12 — 從 S087 出來右轉就到
- `👥 新人短路`：D03 排到 19 站（其它人 27 站）— 入職 4 個月

### 8.3 信心分數 (per route)

- `confidence: 0.87` — 基於 recovered weights 的 hold-out accuracy + 解算 gap
- 低於 0.6 在 UI 標紅，主管必須手動 review

---

## 9. 資料映射補充 — Excel 對應到新層


| Sheet         | 學歷史 ① 用法        | 戰略 ② 用法     | 戰術 ③ 用法 | 解釋 ⑤ 用法     |
| ------------- | --------------------- | ---------------- | ------------ | ---------------- |
| 01 配送據點   | filter scope          | depot 起終點     | depot        | DC name 顯示     |
| 02 路線主檔   | **training X**        | baseline lock S1 | —           | 對比 baseline    |
| 03 停靠明細   | **training y (順序)** | beat 切分 S3     | warm-start   | per-stop reason  |
| 04 停靠點主檔 | feature               | 節點屬性         | 節點屬性     | reason tag 來源  |
| 05 物流士車輛 | feature               | constraint       | constraint   | driver context   |
| 06 績效彙總   | **驗證 ground truth** | quarterly KPI    | —           | headline 對比    |
| 07 急件異常   | dynamic learning      | —               | T13 input    | reason: 急件插入 |

---

## 10. 架構 — 模組樹

```
apps/web/src/lib/services/or/
├── kernel/
│   ├── or-types.ts                ★ Strategic + Tactical enum + ORInput + Strategy interface
│   ├── data-loader.ts             Supabase → ORInput
│   └── distance-matrix.ts         Haversine + TomTom cache
│
├── learning/                      ★ ① 學歷史層 (v2 新)
│   ├── inverse-vrp.ts             TS 端呼叫 Python sidecar /inverse-opt
│   ├── feature-extractor.ts       歷史路線 → φ(R) 特徵
│   └── weights-store.ts           or_recovered_weights CRUD
│
├── strategic/                     ★ ② 戰略層 (v2 新)
│   ├── hungarian.ts               S2 - 純 TS Munkres
│   ├── set-partition.ts           S3 - 呼叫 CP-SAT
│   ├── multi-period-vrp.ts        S4
│   ├── quarterly-fair.ts          S5
│   ├── apprentice.ts              S6
│   └── history-lock.ts            S1 - 純 SQL
│
├── tactical/                      ③ 戰術層 (原 strategies/)
│   ├── sweep.ts                   T9
│   ├── vrptw.ts                   T2
│   ├── top-vip.ts                 T4
│   ├── min-max.ts                 T6
│   └── ... (T1, T3, T5, T7-T8, T10-T14)
│
├── autopilot/                     ★ ④ 自動駕駛層 (v2 新)
│   ├── meta-policy.ts             規則表 → 挑算法
│   └── trigger-rules.ts           缺工/大檔期/急件 偵測
│
├── explain/                       ★ ⑤ 解釋層 (v2 新)
│   ├── compare-to-history.ts      Headline 對比卡
│   ├── reason-tagger.ts           per-stop reason tag
│   └── confidence.ts              信心分數
│
├── engines/
│   ├── ortools-bridge.ts          FastAPI sidecar HTTP client
│   └── pure-ts-heuristics.ts      sweep / Hungarian / savings 純 TS
│
└── dispatcher.ts                  Auto-pilot 入口 → 編排 ①②③ → ⑤
```

**Python sidecar (`services/or-engine/`)** 多加 endpoint：

- `POST /solve/vrp` — 戰術層 OR-Tools VRP
- `POST /solve/cp-sat` — 戰略層 CP-SAT
- `POST /inverse-opt` — 學歷史層
- `POST /solve/alns` — T14 pyvrp

---

****## 11. API 變更

`or_planning_jobs.input_parameters` (jsonb) **不用 migration**，schema 擴充：

```ts
export interface OrInputParamsV2 {
  // v1 保留
  service_minutes:        { mean: number; p90: number };
  workload:               { stops_per_driver_target: number; max_minutes_per_driver: number };
  vehicle_capacity_boxes: number;

  // v2 新增 — 預設值就是 auto-pilot
  mode:                   "auto" | "manual" | "compare";   // 預設 auto
  planning_horizon:       "daily" | "quarterly";           // 預設 quarterly
  use_recovered_weights:  boolean;                          // 預設 true
  strategic?:             StrategicPersonality;             // manual 才填
  tactical?:              TacticalPersonality;              // manual 才填
  compare_set?:           Array<{ strategic: StrategicPersonality; tactical: TacticalPersonality }>;
}
```

**新 API endpoints**：

- `POST /api/manager/or-jobs/:id/auto-run` — **一鍵生成** (auto-pilot)；主管預設用這個
- `POST /api/manager/or-jobs/:id/compare` — v1 的並排比較模式（進階）
- `POST /api/manager/or-jobs/:id/explain` — 拉解釋報告
- `POST /api/manager/inverse-opt/run` — 觸發學歷史（cron 月度跑一次，或主管手動）

**Output `OrOutputPlanV1` 擴成 V2** (向後相容):

```ts
export interface OrOutputPlanV2 extends OrOutputPlanV1 {
  engine_version:     string;          // e.g. "auto-v2.s2-hungarian+t2-vrptw"
  strategic_used:     StrategicPersonality | null;
  tactical_used:      TacticalPersonality;
  weights_used:       RecoveredWeights | null;   // null = 沒學歷史
  metrics:            PlanMetrics;
  comparison?:        HistoryComparison;          // 解釋層 headline
  confidence:         number;                     // 0–1
  reasons?:           Record<string /*stop_id*/, ReasonTag[]>;
}
```

---

## 12. UI 變更（剩下的拆給 frontend 同學）

**主管預設視角** — 「規劃任務」頁：

- 大按鈕：「**一鍵生成本季排班**」(auto mode)
- 小字提示：「使用過去 2 季歷史學到的權重 + Hungarian 派工 + VRPTW 排序」
- 結果出來顯示 headline 卡：總里程 / 準時率 / 工時 σ 三大指標 vs 歷史

**進階主管** — 「進階模式」開關打開：

- 顯示 v1 的 14 人格選擇器（戰術層）
- 顯示新的 6 個 strategic 選擇器
- compare 模式可多選

**解釋頁** — 點任一 route → 看 reason tag + per-stop 顏色標記

---

## 13. 分階段執行計畫 (v2)


| Phase                        | Scope                                                                    | 工時      | 完成定義                              |
| ---------------------------- | ------------------------------------------------------------------------ | --------- | ------------------------------------- |
| **P0.1 · 資料底子**         | TomTom geocode → stops.lat/lng；matrix cache 表；Excel 歷史灌進 DB      | 1 day     | 200 個門市拿得到座標 + 歷史 87 條進表 |
| **P0.2 · ③ 戰術 baseline** | 純 TS sweep + Clarke-Wright；FastAPI sidecar; VRPTW (T2)                 | 2 day     | T2 跑得出來                           |
| **P0.3 · ② 戰略 baseline** | S1 history-lock + S2 Hungarian                                           | 1 day     | 季度派工出得來                        |
| **P0.4 · ① 學歷史 MVP**    | feature extractor + structured SVM inverse opt + or_recovered_weights 表 | 2 day     | hold-out τ ≥ 0.6                    |
| **P0.5 · ④ Auto-pilot**    | 規則表 dispatcher；UI 一鍵按鈕                                           | 1 day     | 按鈕 → 出方案                        |
| **P0.6 · ⑤ 解釋層 v1**     | headline 對比卡 + 信心分數 + 3 種 reason tag                             | 1 day     | UI 看得到 reason                      |
| **P0 小計**                  |                                                                          | **8 day** | 端到端閉環，老闆可以 demo             |
| P1.1 · 戰略補完             | S3 set-partition + S5 fair + S6 apprentice                               | 3 day     | —                                    |
| P1.2 · 戰術補完             | T3/T4/T6/T7/T11/T12                                                      | 4 day     | —                                    |
| P1.3 · 學歷史升級           | MaxEntIRL + per-shift weights                                            | 2 day     | —                                    |
| P1.4 · 解釋升級             | 8 種 reason tag + per-pair 對比                                          | 2 day     | —                                    |
| P2 · 進階                   | T13 急件 + T14 ALNS + RL meta-policy                                     | 5 day     | —                                    |

**P0 8 工作天，含五層閉環。比 v1 多 1.5 天但解的是老闆真正要的問題。**

---

## 14. 驗證 (Verification)


| 驗證項                               | 方法                                     | 通過門檻        |
| ------------------------------------ | ---------------------------------------- | --------------- |
| 歷史灌進 DB                          | `select count(*) from historical_routes` | 87+             |
| Geocoding 正確率                     | 抽 20 個門市 manual check                | 100%            |
| Inverse opt 收斂                     | hold-out Kendall-τ                      | ≥ 0.6          |
| Auto-pilot 一鍵流程                  | 按鈕 → 30s 內出方案                     | < 30s           |
| 對比歷史指標                         | T2 vs R1215 actual                       | 至少 1 個指標贏 |
| 解釋報告                             | 每個 stop 至少 1 個 reason tag           | 100%            |
| Materialize → publish → driver app | 端到端 driver 看得到順序                 | 通              |

**測試指令**：

```bash
# 1. 灌歷史資料
cd apps/web && npx tsx scripts/import-historical-routes.ts

# 2. 跑 inverse opt
curl -X POST http://localhost:8000/inverse-opt \
  -d '{"depot_id":"DC001","shift":"夜","since":"2026-01-01"}'

# 3. 一鍵生成
curl -X POST http://localhost:3000/api/manager/or-jobs/{id}/auto-run

# 4. 看解釋
curl http://localhost:3000/api/manager/or-jobs/{id}/explain
```

---

## 15. 風險 & 緩解


| 風險                                           | 緩解                                                          |
| ---------------------------------------------- | ------------------------------------------------------------- |
| 歷史資料品質差 (8 碼路線/雙趟 multi_turn 混亂) | data-loader 先正規化；雙趟拆兩條 logical route                |
| Inverse opt 不收斂 / τ < 0.6                  | fallback 到 manual weights (w=均勻)，UI 標 confidence: low    |
| 一鍵生成被誤用 (主管不看就採用)                | 解釋層強制顯示 headline；confidence < 0.6 紅標必須手動確認    |
| TomTom 額度撞牆                                | geocode 一次性灌；matrix Haversine 為主、TomTom 為輔（cache） |
| Python sidecar 掛                              | TS 端 5s timeout → fallback S1 + T9 純 TS；alert 主管        |
| 老師傅退休後沒新樣本                           | recovered weights 每月 cron 重訓，3 個月沒新資料 alert        |
| 隱性偏見被 encode 進 weights                   | 解釋層攤開每個 reason tag；主管可手動「凍結」某個 weight      |

---

## 16. 開放問題（不阻塞 P0）

- [ ]  季度切點：1/1, 4/1, 7/1, 10/1 還是 Q-spring/summer? P0 先用 1/1
- [ ]  VIP 分數欄位用 03.weight 還是業務手填？P0 用 weight × store_tier
- [ ]  driver_skill_profile 怎麼算？P0 用「過去 N 季的平均準時率 + 平均完工時間 + 服務站數」
- [ ]  跨 DC 共用車輛？P0 假設不共用
- [ ]  季度中間有人離職怎麼處理？P0 觸發 S6 apprentice rebuild
- [ ]  老師傅看到 OR 結果不滿意，怎麼回饋？P1 加 thumb-down 按鈕，收進 inverse opt 下次訓練

---

## 附錄 A · 學歷史 (Inverse OR) 參考文獻

- Chen et al. (2022) — *Inverse VRP*. https://arxiv.org/abs/2206.13989
- Ng & Russell (2000) — *Algorithms for IRL*. https://ai.stanford.edu/~ang/papers/icml00-irl.pdf
- Ziebart et al. (2008) — *MaxEnt IRL*. https://www.aaai.org/Papers/AAAI/2008/AAAI08-227.pdf
- Bertsimas et al. (2015) — *Data-driven IRL*. https://doi.org/10.1287/opre.2015.1361
- Ratliff et al. (2006) — *Maximum Margin Planning*. https://www.ri.cmu.edu/pub_files/pub4/ratliff_nathan_2006_1/ratliff_nathan_2006_1.pdf

## 附錄 B · OR 求解器參考

- Google OR-Tools VRP — https://developers.google.com/optimization/routing
- PyVRP (HGS-SPRINT) — https://github.com/PyVRP/PyVRP (Wouda 2024)
- VROOM — https://github.com/VROOM-Project/vroom
- ALNS — Ropke & Pisinger 2006 — https://doi.org/10.1287/trsc.1050.0135
- Hungarian / Munkres — Kuhn 1955
- TomTom Traffic Stats — https://developer.tomtom.com/traffic-stats/documentation

## 附錄 C · 對應檔案

- 取代: [or-planning-service.ts](../apps/web/src/lib/services/or-planning-service.ts) → dispatcher 化
- 擴充: [OrInputForm.tsx](../apps/web/src/app/(manager)/or-replanning/OrInputForm.tsx) (加 mode/horizon 欄位) · [domain.ts](../apps/web/src/types/domain.ts) (OrOutputPlanV2)
- 新檔: [or/kernel/or-types.ts](../apps/web/src/lib/services/or/kernel/or-types.ts) + 上面 §10 樹狀清單
- 不動: [route-plan-service.ts](../apps/web/src/lib/services/route-plan-service.ts) · driver_app
- 新 sidecar: `services/or-engine/` (FastAPI + OR-Tools + pyvrp + scipy)

---

## v1 → v2 變更摘要


| 層          | v1                       | v2                                                   |
| ----------- | ------------------------ | ---------------------------------------------------- |
| 戰略 (季度) | 無                       | **6 種算法 S1–S6**                                  |
| 戰術 (日)   | 14 種人格                | 同 (改前綴 T1–T14)                                  |
| 學歷史      | 無                       | **inverse VRP + recovered weights**                  |
| 主管入口    | 14 選 1 + objective 下拉 | **一鍵按鈕 + auto-pilot meta-policy**                |
| 解釋        | metrics 卡               | **headline 對比 + per-stop reason tag + confidence** |
| 規劃週期    | 日                       | **季度 + 日 二層**                                   |
| P0 工時     | 6.5 天                   | 8 天                                                 |

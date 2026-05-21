# OR 路線規劃模組 (v2)

> 完整設計文件: [docs/OR_DESIGN.md](../../../../../docs/OR_DESIGN.md)
>
> v2 比 v1 多 4 層：學歷史 / 戰略 / 自動駕駛 / 解釋

## 五層架構

```
or/
├── kernel/
│   ├── or-types.ts                ★ Strategic + Tactical enum + ORInput + RecoveredWeights + Output V2
│   ├── data-loader.ts             (P0) Supabase → ORInput
│   └── distance-matrix.ts         (P0) Haversine + TomTom cache
│
├── learning/                      ★ ① 學歷史層
│   ├── inverse-vrp.ts             呼叫 sidecar /inverse-opt
│   ├── feature-extractor.ts       歷史路線 → φ(R) 特徵向量
│   └── weights-store.ts           or_recovered_weights CRUD
│
├── strategic/                     ★ ② 戰略層 (季度)
│   ├── history-lock.ts            S1
│   ├── hungarian.ts               S2  ★ P0 預設
│   ├── set-partition.ts           S3
│   ├── multi-period-vrp.ts        S4
│   ├── quarterly-fair.ts          S5
│   └── apprentice.ts              S6
│
├── tactical/                      ③ 戰術層 (日)
│   ├── sweep.ts                   T9  ★ P0 baseline
│   ├── vrptw.ts                   T2  ★ P0 預設
│   ├── top-vip.ts                 T4
│   ├── min-max.ts                 T6
│   └── ... (T1, T3, T5, T7-T8, T10-T14)
│
├── autopilot/                     ★ ④ Auto-pilot meta-policy
│   ├── meta-policy.ts             trigger → (strategic, tactical) lookup
│   └── trigger-rules.ts           缺工 / 大檔期 / 急件 偵測
│
├── explain/                       ★ ⑤ 解釋層
│   ├── compare-to-history.ts      headline KPI 對比
│   ├── reason-tagger.ts           per-stop reason tag (8 種)
│   └── confidence.ts              0–1 信心分數
│
├── engines/
│   ├── ortools-bridge.ts          FastAPI sidecar HTTP client
│   └── pure-ts-heuristics.ts      sweep / Hungarian / savings 純 TS
│
└── dispatcher.ts                  Auto-pilot 入口 — 編排 ①②③ 出 ⑤
```

## 換 mock 的閉環路徑

1. `or-planning-service.ts` 的 `runMockPlanningJob` 改成呼叫 `dispatcher.runAutoPilot(jobId)`
2. `input_parameters.mode = "auto"` 觸發自動駕駛；`"manual"` 走 v1 14 人格選擇
3. Output 仍寫 `or_planning_jobs.output_plan` (jsonb)，schema = `OrOutputPlanV2` (向後相容 V1)
4. 既有 `materialize` / `materialize-and-publish` / `generateDailyTasks` 流程**不用改**

## Phase 0 必做 (8 工作天)

| 模組 | 工時 |
|---|---|
| P0.1 資料底子 (geocode + matrix cache + Excel 灌歷史) | 1d |
| P0.2 ③ 戰術: sweep + Clarke-Wright + VRPTW + sidecar | 2d |
| P0.3 ② 戰略: S1 history-lock + S2 Hungarian | 1d |
| P0.4 ① 學歷史: inverse opt MVP + or_recovered_weights | 2d |
| P0.5 ④ Auto-pilot: 規則 dispatcher + 一鍵 UI | 1d |
| P0.6 ⑤ 解釋: headline + 3 reason tag + confidence | 1d |

## 一鍵生成的閉環

```ts
// dispatcher.ts 偽碼
async function runAutoPilot(jobId: string) {
  const input   = await loadORInput(jobId);
  const weights = await getRecoveredWeights(input.depot.depot_id, input.shift);
  const trigger = detectTrigger(input);            // ④
  const choice  = META_POLICY[trigger];            // ④
  const groups  = await STRATEGIC[choice.strategic].solve(input);    // ②
  const routes  = await Promise.all(groups.map(g =>
    TACTICAL[choice.tactical].solve({ ...input, stops: g.stops, weights })  // ③
  ));
  const plan    = mergePlan(routes);
  plan.comparison = await compareToHistory(plan, input);             // ⑤
  plan.reasons    = tagReasons(plan, input);                          // ⑤
  plan.confidence = computeConfidence(weights, plan);                 // ⑤
  return plan;
}
```

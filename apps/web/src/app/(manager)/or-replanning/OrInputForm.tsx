"use client";

import * as React from "react";
import { Field, FieldGroup } from "@/components/form/Field";
import { NumberInput } from "@/components/form/NumberInput";
import { Slider } from "@/components/form/Slider";

/**
 * MTVRP 規劃參數 — 跟 or-engine/vrp_gurobi.py 的全域參數 1:1 對齊。
 *
 * OR 目標式：
 *   min α·(總工時+服務) + β·(派工人數) + γ·(加班) + δ_W·(W_max−W_min) + δ_B·(B_max−B_min)
 *
 * OR 全域參數（這個 UI 只顯示這些）：
 *   - R     一日趟次（1 或 2）
 *   - H̄    工時上限（硬約束 F）
 *   - H     加班門檻（O[p] >= W[p] - H 用，乘 γ）
 *   - α/β/γ/δ_W/δ_B  目標式 5 個權重
 *
 * 不在這裡（OR 不是用全域而是 per-driver / per-stop 抓）：
 *   - Q 車輛容量 — 從 profiles.vehicle_capacity
 *   - σ 服務時間 — 從 stops.default_service_minutes
 *   - q 箱數    — 從 stops.avg_delivery_volume
 *   - shift 班別 — 從 profiles.shift / stops.shift
 *   - 班別 / 溫層 相容性 — driver profile vs stops 主檔比對
 */
export interface OrInputParams {
  weights: {
    alpha_travel_time: number;   // α
    beta_dispatch:     number;   // β
    gamma_overtime:    number;   // γ
    delta_workload:    number;   // δ_W
    delta_boxes:       number;   // δ_B
  };
  hours: {
    max_work_minutes:    number;  // H̄（硬上限）
    overtime_threshold:  number;  // H（加班門檻）
  };
  num_trips: 1 | 2;
  /**
   * 這次試算要分給幾位物流士（OR 集合 P 大小）。
   * null / 0 = 使用所有啟用中物流士；正整數 = 強制限制到 N 位。
   */
  num_drivers: number | null;
}

export const DEFAULT_OR_INPUT: OrInputParams = {
  // 預設值對齊 OR/solve_from_matrix_csv.py CONFIG 區
  weights: {
    alpha_travel_time: 1.0,
    beta_dispatch:     300.0,
    gamma_overtime:    1.5,
    delta_workload:    1.0,
    delta_boxes:       0.5
  },
  hours: {
    max_work_minutes:   720,    // 12h
    overtime_threshold: 480     // 8h
  },
  num_trips: 2,
  num_drivers: null              // null = 用全部啟用中物流士
};

interface Props {
  value: OrInputParams;
  onChange: (next: OrInputParams) => void;
  readOnly?: boolean;
}

export function OrInputForm({ value, onChange, readOnly }: Props) {
  const set = <K extends keyof OrInputParams>(k: K, v: OrInputParams[K]) =>
    onChange({ ...value, [k]: v });
  const setW = (patch: Partial<OrInputParams["weights"]>) =>
    onChange({ ...value, weights: { ...value.weights, ...patch } });
  const setH = (patch: Partial<OrInputParams["hours"]>) =>
    onChange({ ...value, hours: { ...value.hours, ...patch } });

  return (
    <div className="space-y-4">
      {/* 1. 一日趟次（R） */}
      <FieldGroup title="1. 一日趟次 R" description="每位物流士最多回 depot 補貨幾次（OR 集合 R）">
        <Field label="趟次" className="sm:col-span-2">
          <div className="flex gap-2">
            {([1, 2] as const).map((n) => (
              <button
                key={n}
                type="button"
                disabled={readOnly}
                onClick={() => set("num_trips", n)}
                className={
                  "rounded-md border px-4 py-1.5 text-sm font-medium transition " +
                  (value.num_trips === n
                    ? "border-brand-500 bg-brand-50 text-brand-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50") +
                  (readOnly ? " cursor-not-allowed opacity-60" : "")
                }
              >
                {n === 1 ? "1 趟（單班）" : "2 趟（早晚二配）"}
              </button>
            ))}
          </div>
        </Field>
      </FieldGroup>

      {/* 2. 工時規則 H̄ / H + 派遣人數 */}
      <FieldGroup
        title="2. 工時規則"
        description="H̄ 是硬上限（OR 約束 F），H 是加班門檻（與 γ 一起算超時成本）；派遣人數限制這次試算最多分給幾位物流士"
      >
        <Field label="H̄ — 工時上限" suffix="分鐘" hint="超過會 infeasible，OR 會 fallback 開新司機">
          <NumberInput
            value={value.hours.max_work_minutes}
            onChange={(n) => setH({ max_work_minutes: n })}
            min={60} step={30} disabled={readOnly}
          />
        </Field>
        <Field label="H — 加班門檻" suffix="分鐘" hint="超過此值的分鐘乘 γ 加入目標">
          <NumberInput
            value={value.hours.overtime_threshold}
            onChange={(n) => setH({ overtime_threshold: n })}
            min={60} step={30} disabled={readOnly}
          />
        </Field>
        <Field
          label="派遣人數"
          suffix="位"
          hint="這次試算最多分給幾位啟用中物流士。0 = 全部"
          className="sm:col-span-2"
        >
          <NumberInput
            value={value.num_drivers ?? 0}
            onChange={(n) => set("num_drivers", n > 0 ? n : null)}
            min={0} max={20} step={1} disabled={readOnly}
          />
        </Field>
      </FieldGroup>

      {/* 3. 5 個 OR 權重 */}
      <FieldGroup
        title="3. OR 目標函數權重"
        description="min α·(總工時) + β·(派工數) + γ·(加班) + δ_W·(工時差距) + δ_B·(箱數差距)"
      >
        <Field
          label="α — 工時成本"
          hint="越大 → 越在意縮短總配送時間（行駛 + 服務）"
          className="sm:col-span-2"
        >
          <Slider
            value={value.weights.alpha_travel_time}
            onChange={(n) => setW({ alpha_travel_time: n })}
            min={0} max={5} step={0.1}
            disabled={readOnly}
            suffix="元/分鐘"
          />
        </Field>

        <Field
          label="β — 派工成本"
          hint="越大 → 越想集中派少數人；越小 → 分散到所有 driver。所有啟用的物流士都會被 OR 自動納入。"
          className="sm:col-span-2"
        >
          <Slider
            value={value.weights.beta_dispatch}
            onChange={(n) => setW({ beta_dispatch: n })}
            min={0} max={1000} step={10}
            disabled={readOnly}
            suffix="元/人"
          />
        </Field>

        <Field
          label="γ — 加班成本"
          hint="工時超過 H 的每一分鐘乘上此值加入目標"
          className="sm:col-span-2"
        >
          <Slider
            value={value.weights.gamma_overtime}
            onChange={(n) => setW({ gamma_overtime: n })}
            min={0} max={10} step={0.1}
            disabled={readOnly}
            suffix="元/分鐘"
          />
        </Field>

        <Field
          label="δ_W — 工時不平衡懲罰"
          hint="把 (max W − min W) 乘上此值加入目標。越大 → 工時越平均"
          className="sm:col-span-2"
        >
          <Slider
            value={value.weights.delta_workload}
            onChange={(n) => setW({ delta_workload: n })}
            min={0} max={5} step={0.1}
            disabled={readOnly}
            suffix="元/分鐘"
          />
        </Field>

        <Field
          label="δ_B — 箱數不平衡懲罰"
          hint="把 (max B − min B) 乘上此值加入目標。越大 → 各 driver 載運箱數越平均"
          className="sm:col-span-2"
        >
          <Slider
            value={value.weights.delta_boxes}
            onChange={(n) => setW({ delta_boxes: n })}
            min={0} max={5} step={0.1}
            disabled={readOnly}
            suffix="元/箱"
          />
        </Field>
      </FieldGroup>
    </div>
  );
}

/**
 * 把任意 JSON 物件（可能來自舊版 DB）解析成 OrInputParams，缺欄位用 default 補。
 * 支援舊版 `defaults.{max_work_minutes,vehicle_capacity_boxes,service_minutes_default}`
 * 但只取 max_work_minutes（其餘改為 per-driver / per-stop master data）。
 */
export function parseOrInputParams(raw: unknown): OrInputParams {
  const r = (raw ?? {}) as Record<string, any>;
  const tripsRaw = Number(r?.num_trips);
  const trips = tripsRaw === 1 ? 1 : 2;
  return {
    weights: {
      alpha_travel_time: Number(
        r?.weights?.alpha_travel_time ?? DEFAULT_OR_INPUT.weights.alpha_travel_time
      ),
      beta_dispatch: Number(
        r?.weights?.beta_dispatch ?? DEFAULT_OR_INPUT.weights.beta_dispatch
      ),
      gamma_overtime: Number(
        r?.weights?.gamma_overtime ?? DEFAULT_OR_INPUT.weights.gamma_overtime
      ),
      delta_workload: Number(
        r?.weights?.delta_workload ?? DEFAULT_OR_INPUT.weights.delta_workload
      ),
      delta_boxes: Number(
        r?.weights?.delta_boxes ?? DEFAULT_OR_INPUT.weights.delta_boxes
      )
    },
    hours: {
      max_work_minutes: Number(
        r?.hours?.max_work_minutes
          ?? r?.defaults?.max_work_minutes
          ?? DEFAULT_OR_INPUT.hours.max_work_minutes
      ),
      overtime_threshold: Number(
        r?.hours?.overtime_threshold
          ?? DEFAULT_OR_INPUT.hours.overtime_threshold
      )
    },
    num_trips: trips,
    num_drivers: (() => {
      const v = r?.num_drivers;
      if (v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    })()
  };
}

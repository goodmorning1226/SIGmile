"use client";

import * as React from "react";
import { Field, FieldGroup } from "@/components/form/Field";
import { NumberInput } from "@/components/form/NumberInput";
import { Slider } from "@/components/form/Slider";

/**
 * MTVRP 主管端參數。「duration matrix」「service_minutes」「demand」這些
 * **不**列在這裡：它們從 stops 主檔抓（OR engine 跑時自動帶入 + 用 TomTom 算行車時間）。
 *
 * 主管可調整：
 *   - 權重 α (時間成本) / β (派工成本)
 *   - 預設容量 / 預設工時上限（fallback；driver profile 有就優先用）
 *   - 一日趟次（1 = 單趟 / 2 = 早晚二配）
 */
export interface OrInputParams {
  weights: {
    alpha_travel_time: number;
    beta_dispatch:     number;
  };
  defaults: {
    vehicle_capacity_boxes: number;
    max_work_minutes:       number;
    service_minutes_default: number;
  };
  num_trips: 1 | 2;
}

export const DEFAULT_OR_INPUT: OrInputParams = {
  // β=50 預設：對小規模 demo（10-30 stops）讓 OR 偏好分多人；
  // 真實大量資料時主管可拉高（β↑ → 集中）或拉低（β↓ → 分散）
  weights: { alpha_travel_time: 1.0, beta_dispatch: 50.0 },
  defaults: {
    vehicle_capacity_boxes: 60,
    max_work_minutes: 480,
    service_minutes_default: 10
  },
  num_trips: 2
};

interface Props {
  value: OrInputParams;
  onChange: (next: OrInputParams) => void;
  readOnly?: boolean;
}

export function OrInputForm({ value, onChange, readOnly }: Props) {
  const set = <K extends keyof OrInputParams>(k: K, v: OrInputParams[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <div className="space-y-4">
      <FieldGroup title="一日趟次" description="OR 規劃時每位物流士最多可以跑幾趟（回 depot 補貨次數 +1）">
        <Field label="趟次" className="sm:col-span-2">
          <div className="flex gap-2">
            {[1, 2].map((n) => (
              <button
                key={n}
                type="button"
                disabled={readOnly}
                onClick={() => set("num_trips", n as 1 | 2)}
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

      <FieldGroup
        title="預設車輛 / 工時"
        description="物流士個人檔案 (profile) 有設就以個人為準；以下為 fallback。"
      >
        <Field label="預設單車容量" suffix="箱">
          <NumberInput
            value={value.defaults.vehicle_capacity_boxes}
            onChange={(n) => set("defaults", { ...value.defaults, vehicle_capacity_boxes: n })}
            min={1} disabled={readOnly}
          />
        </Field>
        <Field label="預設工時上限" suffix="分鐘" hint="超過就會 fallback 開新司機">
          <NumberInput
            value={value.defaults.max_work_minutes}
            onChange={(n) => set("defaults", { ...value.defaults, max_work_minutes: n })}
            min={60} step={30} disabled={readOnly}
          />
        </Field>
        <Field label="預設服務時間" suffix="分鐘" hint="停靠點本身沒設定時用">
          <NumberInput
            value={value.defaults.service_minutes_default}
            onChange={(n) => set("defaults", { ...value.defaults, service_minutes_default: n })}
            min={1} disabled={readOnly}
          />
        </Field>
      </FieldGroup>

      <FieldGroup title="OR 成本權重" description="拖動滑桿調整不同成本在優化目標中的權重">
        <Field
          label="α — 配送時間成本"
          hint="越大 → OR 越在意縮短總配送時間（行駛 + 服務）"
          className="sm:col-span-2"
        >
          <Slider
            value={value.weights.alpha_travel_time}
            onChange={(n) => set("weights", { ...value.weights, alpha_travel_time: n })}
            min={0} max={5} step={0.1}
            disabled={readOnly}
            suffix="元/分鐘"
          />
        </Field>
        <Field
          label="β — 派工成本"
          hint="越大 → OR 越想集中到少數人；越小 → 越想分散到所有物流士。所有啟用中的物流士都會被 OR 自動納入（不用設 SQL）。"
          className="sm:col-span-2"
        >
          <Slider
            value={value.weights.beta_dispatch}
            onChange={(n) => set("weights", { ...value.weights, beta_dispatch: n })}
            min={0} max={1000} step={10}
            disabled={readOnly}
            suffix="元/人"
          />
        </Field>
      </FieldGroup>
    </div>
  );
}

/**
 * 把任意 JSON 物件（可能來自舊版 DB）解析成 OrInputParams，缺欄位用 default 補。
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
      )
    },
    defaults: {
      vehicle_capacity_boxes: Number(
        r?.defaults?.vehicle_capacity_boxes
          ?? r?.vehicle_capacity_boxes
          ?? DEFAULT_OR_INPUT.defaults.vehicle_capacity_boxes
      ),
      max_work_minutes: Number(
        r?.defaults?.max_work_minutes
          ?? r?.workload?.max_minutes_per_driver
          ?? DEFAULT_OR_INPUT.defaults.max_work_minutes
      ),
      service_minutes_default: Number(
        r?.defaults?.service_minutes_default
          ?? r?.service_minutes?.mean
          ?? DEFAULT_OR_INPUT.defaults.service_minutes_default
      )
    },
    num_trips: trips
  };
}

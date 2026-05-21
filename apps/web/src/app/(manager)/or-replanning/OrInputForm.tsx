"use client";

import * as React from "react";
import { Field, FieldGroup } from "@/components/form/Field";
import { NumberInput } from "@/components/form/NumberInput";
import { Slider } from "@/components/form/Slider";
import { Leaf, Clock, Scale, Sliders } from "lucide-react";

/**
 * MTVRP 主管端參數（v2 — 預設模式驅動）。
 *
 * v1 把 α/β slider 直接秀給主管 → 工程師味太重，沒人會調。
 * v2 改成 3 個 preset（省成本 / 準時 / 公平），主管 1 按鈕搞定。
 * 進階模式仍保留 α/β 給有興趣的人微調。
 *
 * Preset 映射：
 *   - "eco_cost"   : α=1.0, β=200  (集中派工，省人力 + 燃料)
 *   - "on_time"    : α=2.5, β=80   (時間成本高，多派人換準時)
 *   - "fair_load"  : α=1.5, β=20   (人力成本低 → 分散到所有 driver 公平)
 */
export type OrPreset = "eco_cost" | "on_time" | "fair_load" | "custom";

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
  /** v2 — 用 preset 紀錄主管在 UI 上選的「臉」，便於 audit */
  preset?: OrPreset;
}

const PRESET_WEIGHTS: Record<Exclude<OrPreset, "custom">, OrInputParams["weights"]> = {
  eco_cost: { alpha_travel_time: 1.0, beta_dispatch: 200 },
  on_time:  { alpha_travel_time: 2.5, beta_dispatch: 80 },
  fair_load:{ alpha_travel_time: 1.5, beta_dispatch: 20 }
};

export const DEFAULT_OR_INPUT: OrInputParams = {
  weights: PRESET_WEIGHTS.on_time,
  defaults: {
    vehicle_capacity_boxes: 60,
    max_work_minutes: 480,
    service_minutes_default: 10
  },
  num_trips: 2,
  preset: "on_time"
};

interface Props {
  value: OrInputParams;
  onChange: (next: OrInputParams) => void;
  readOnly?: boolean;
}

const PRESET_CARDS: Array<{
  key: Exclude<OrPreset, "custom">;
  icon: React.ReactNode;
  label: string;
  description: string;
  detail: string;
  tone: string;
}> = [
  {
    key: "eco_cost",
    icon: <Leaf className="size-5" />,
    label: "省成本",
    description: "集中派少數人，省人力 + 燃料",
    detail: "適合：淡季 / 量少日 / 想壓人事費",
    tone: "bg-emerald-50 border-emerald-200 text-emerald-700 hover:border-emerald-400"
  },
  {
    key: "on_time",
    icon: <Clock className="size-5" />,
    label: "準時優先",
    description: "多派人換準時率，避免時間窗違規",
    detail: "適合：旺季 / 時間窗緊客戶多 / VIP 大單",
    tone: "bg-amber-50 border-amber-200 text-amber-700 hover:border-amber-400"
  },
  {
    key: "fair_load",
    icon: <Scale className="size-5" />,
    label: "工時公平",
    description: "全員平均，避免有人超載有人閒",
    detail: "適合：固定編制 / 新人多 / 工會關係",
    tone: "bg-blue-50 border-blue-200 text-blue-700 hover:border-blue-400"
  }
];

export function OrInputForm({ value, onChange, readOnly }: Props) {
  const [advanced, setAdvanced] = React.useState(value.preset === "custom");

  const selectPreset = (key: Exclude<OrPreset, "custom">) => {
    if (readOnly) return;
    onChange({
      ...value,
      weights: PRESET_WEIGHTS[key],
      preset: key
    });
    setAdvanced(false);
  };

  const set = <K extends keyof OrInputParams>(k: K, v: OrInputParams[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <div className="space-y-4">
      {/* Step A: 3 preset cards */}
      <div>
        <div className="mb-2 text-sm font-semibold text-slate-800">
          1. 排線目標
          <span className="ml-1 font-normal text-xs text-slate-500">
            (主管選一個就好，OR 會自動套用對應權重)
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {PRESET_CARDS.map((card) => {
            const active = value.preset === card.key;
            return (
              <button
                key={card.key}
                type="button"
                disabled={readOnly}
                onClick={() => selectPreset(card.key)}
                className={
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition " +
                  (active
                    ? "border-brand-500 bg-brand-50 ring-2 ring-brand-200"
                    : `border-slate-200 hover:bg-slate-50 ${readOnly ? "cursor-not-allowed opacity-60" : ""}`)
                }
              >
                <div className={
                  "grid size-9 shrink-0 place-items-center rounded-lg " +
                  (active ? "bg-brand-100 text-brand-700" : card.tone)
                }>
                  {card.icon}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900">{card.label}</div>
                  <div className="mt-0.5 text-xs text-slate-600">{card.description}</div>
                  <div className="mt-1 text-[11px] text-slate-400">{card.detail}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step B: 一日趟次 */}
      <FieldGroup title="2. 一日趟次" description="每位物流士最多回 depot 補貨幾次">
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

      {/* Step C: 預設容量 / 工時 */}
      <FieldGroup
        title="3. 預設車輛 / 工時"
        description="物流士個人檔案有設就以個人為準；以下為 fallback。"
      >
        <Field label="預設單車容量" suffix="箱">
          <NumberInput
            value={value.defaults.vehicle_capacity_boxes}
            onChange={(n) => set("defaults", { ...value.defaults, vehicle_capacity_boxes: n })}
            min={1} disabled={readOnly}
          />
        </Field>
        <Field label="預設工時上限" suffix="分鐘" hint="超過會 fallback 開新司機">
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

      {/* Step D: 進階展開 */}
      <button
        type="button"
        disabled={readOnly}
        onClick={() => setAdvanced((a) => !a)}
        className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Sliders className="size-3.5" />
        {advanced ? "收起進階設定 (α / β)" : "進階：手動調整 α (時間成本) / β (派工成本)"}
      </button>

      {advanced && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/30 p-4">
          <p className="mb-3 text-xs text-slate-500">
            α 越大 → OR 越想縮短總配送時間。β 越大 → OR 越想集中到少數人。
            改完會覆蓋上方 preset，preset 顯示「自訂」。
          </p>
          <div className="grid grid-cols-1 gap-4">
            <Field label="α — 配送時間成本" hint="元 / 分鐘" className="sm:col-span-2">
              <Slider
                value={value.weights.alpha_travel_time}
                onChange={(n) => onChange({
                  ...value,
                  weights: { ...value.weights, alpha_travel_time: n },
                  preset: "custom"
                })}
                min={0} max={5} step={0.1}
                disabled={readOnly}
                suffix="元/分鐘"
              />
            </Field>
            <Field label="β — 派工成本" hint="元 / 人" className="sm:col-span-2">
              <Slider
                value={value.weights.beta_dispatch}
                onChange={(n) => onChange({
                  ...value,
                  weights: { ...value.weights, beta_dispatch: n },
                  preset: "custom"
                })}
                min={0} max={1000} step={10}
                disabled={readOnly}
                suffix="元/人"
              />
            </Field>
          </div>
          {value.preset === "custom" && (
            <div className="mt-2 text-xs text-amber-700">⚠️ 已切換成自訂模式</div>
          )}
        </div>
      )}
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
  const preset = typeof r?.preset === "string" ? r.preset as OrPreset : undefined;
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
    num_trips: trips,
    preset
  };
}

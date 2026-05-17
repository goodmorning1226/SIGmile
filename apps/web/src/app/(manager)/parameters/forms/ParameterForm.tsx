"use client";

import * as React from "react";
import { Field, FieldGroup } from "@/components/form/Field";
import { NumberInput, PercentInput } from "@/components/form/NumberInput";
import { SelectInput } from "@/components/form/SelectInput";
import { TagsInput } from "@/components/form/TagsInput";

/**
 * 不同 prediction_type 的表單。每個 form 接 `value`（已存的 JSON 物件）並透過
 * `onChange` 回傳新 JSON 物件。檔案內部不知道 JSON 細節，只負責畫表單。
 *
 * 之後串真實 AI service 時：output_parameters 的 schema 可以擴充，
 * 只要在這檔加新欄位或新表單即可。
 */

type Params = Record<string, unknown>;

interface FormProps {
  value: Params;
  onChange: (next: Params) => void;
}

/** 取得 nested 路徑（用點分隔）的值 */
function get(obj: Params, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object") return (acc as Params)[k];
    return undefined;
  }, obj);
}

/** 設定 nested 路徑的值（immutable copy） */
function set(obj: Params, path: string, val: unknown): Params {
  const keys = path.split(".");
  const next: Params = { ...obj };
  let cur: Params = next;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    const v = cur[k];
    cur[k] = v && typeof v === "object" ? { ...(v as Params) } : {};
    cur = cur[k] as Params;
  }
  cur[keys[keys.length - 1]] = val;
  return next;
}

/* -------------------------------------------------------------- */
/*  Helpers                                                        */
/* -------------------------------------------------------------- */

function NumField({
  path, label, suffix, hint, value, onChange,
  step, min, max
}: FormProps & { path: string; label: string; suffix?: string; hint?: string; step?: number; min?: number; max?: number }) {
  const v = Number(get(value, path) ?? 0);
  return (
    <Field label={label} hint={hint} suffix={suffix}>
      <NumberInput
        value={v}
        step={step}
        min={min}
        max={max}
        onChange={(n) => onChange(set(value, path, n))}
      />
    </Field>
  );
}

function PercField({
  path, label, hint, value, onChange
}: FormProps & { path: string; label: string; hint?: string }) {
  const v = Number(get(value, path) ?? 0);
  return (
    <Field label={label} hint={hint} suffix="%">
      <PercentInput value={v} onChange={(n) => onChange(set(value, path, n))} />
    </Field>
  );
}

/* -------------------------------------------------------------- */
/*  Forms per prediction_type                                      */
/* -------------------------------------------------------------- */

export function ServiceMinutesForm({ value, onChange }: FormProps) {
  return (
    <div className="space-y-4">
      <FieldGroup
        title="服務時間概況"
        description="物流士在每一站平均花費的時間"
      >
        <NumField label="平均服務時間" path="mean" suffix="分鐘" min={0} step={1}
                  value={value} onChange={onChange} />
        <NumField label="P90 服務時間" path="p90"  suffix="分鐘" min={0} step={1}
                  hint="90% 的站會在這個時間內完成"
                  value={value} onChange={onChange} />
      </FieldGroup>

      <FieldGroup
        title="依門市類型細分"
        description="不同類型門市的平均服務時間"
      >
        <NumField label="便利商店" path="by_stop_type.convenience_store" suffix="分鐘" min={0} step={1}
                  value={value} onChange={onChange} />
        <NumField label="超市" path="by_stop_type.supermarket" suffix="分鐘" min={0} step={1}
                  value={value} onChange={onChange} />
      </FieldGroup>
    </div>
  );
}

export function StopDemandForm({ value, onChange }: FormProps) {
  return (
    <div className="space-y-4">
      <FieldGroup title="貨量預估" description="每家門市每日預估配送量">
        <NumField label="平均每日箱數" path="mean_boxes_per_day" suffix="箱" min={0} step={1}
                  value={value} onChange={onChange} />
        <Field label="尖峰日">
          <SelectInput
            value={String(get(value, "peak_day_of_week") ?? "Friday")}
            onChange={(v) => onChange(set(value, "peak_day_of_week", v))}
            options={[
              { value: "Monday",    label: "星期一" },
              { value: "Tuesday",   label: "星期二" },
              { value: "Wednesday", label: "星期三" },
              { value: "Thursday",  label: "星期四" },
              { value: "Friday",    label: "星期五" },
              { value: "Saturday",  label: "星期六" },
              { value: "Sunday",    label: "星期日" }
            ]}
          />
        </Field>
      </FieldGroup>

      <FieldGroup title="成長趨勢" description="量體預期月增率">
        <PercField label="月成長率" path="growth_rate" value={value} onChange={onChange} />
      </FieldGroup>
    </div>
  );
}

export function EtaForm({ value, onChange }: FormProps) {
  return (
    <FieldGroup title="行車時間" description="站與站之間的平均行車時間估算">
      <NumField label="站間平均行車時間" path="avg_travel_minutes_between_stops"
                suffix="分鐘" min={0} step={1}
                value={value} onChange={onChange} />
      <NumField label="尖峰時段倍率" path="peak_hour_multiplier"
                hint="例如 1.4 表示尖峰要多 40% 時間"
                min={1} step={0.1}
                value={value} onChange={onChange} />
    </FieldGroup>
  );
}

export function WorkloadForm({ value, onChange }: FormProps) {
  return (
    <FieldGroup title="員工負荷" description="每位物流士每日的工作量上限">
      <NumField label="每人目標站數" path="stops_per_driver_target"
                suffix="站" min={0} step={1}
                value={value} onChange={onChange} />
      <NumField label="每人工時上限" path="max_minutes_per_driver"
                suffix="分鐘" min={0} step={10}
                value={value} onChange={onChange} />
    </FieldGroup>
  );
}

export function RiskForm({ value, onChange }: FormProps) {
  const zones = (get(value, "high_risk_zones") as string[] | undefined) ?? [];
  return (
    <div className="space-y-4">
      <FieldGroup title="高風險區域" description="容易延誤、交通狀況差的區域">
        <Field
          label="區域列表"
          hint="輸入後按 Enter 加入，例如「板橋」"
          className="sm:col-span-2"
        >
          <TagsInput
            value={zones}
            onChange={(arr) => onChange(set(value, "high_risk_zones", arr))}
            placeholder="輸入區域名稱"
          />
        </Field>
      </FieldGroup>

      <FieldGroup title="風險因子">
        <PercField label="延誤發生機率" path="delay_probability"
                   hint="預估配送過程中發生延誤的機率"
                   value={value} onChange={onChange} />
        <PercField label="天候影響因子" path="weather_factor"
                   hint="壞天氣造成的額外延誤比率"
                   value={value} onChange={onChange} />
      </FieldGroup>
    </div>
  );
}

/* -------------------------------------------------------------- */
/*  Dispatcher                                                     */
/* -------------------------------------------------------------- */

export function ParameterForm({
  predictionType, value, onChange
}: FormProps & { predictionType: string }) {
  switch (predictionType) {
    case "service_minutes": return <ServiceMinutesForm value={value} onChange={onChange} />;
    case "stop_demand":     return <StopDemandForm    value={value} onChange={onChange} />;
    case "eta":             return <EtaForm           value={value} onChange={onChange} />;
    case "workload":        return <WorkloadForm      value={value} onChange={onChange} />;
    case "risk":            return <RiskForm          value={value} onChange={onChange} />;
    default:
      return (
        <div className="rounded-md bg-slate-50 p-4 text-sm text-slate-500">
          此類型尚未提供表單編輯，請等候後續更新。
        </div>
      );
  }
}

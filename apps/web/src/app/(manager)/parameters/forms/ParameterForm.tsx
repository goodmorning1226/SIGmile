"use client";

import * as React from "react";
import { Field, FieldGroup } from "@/components/form/Field";
import { NumberInput, PercentInput } from "@/components/form/NumberInput";
import { SelectInput } from "@/components/form/SelectInput";

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

/* -------------------------------------------------------------- */
/*  Dispatcher — 只支援 OR 真的會用到的 σ 和 q                      */
/* -------------------------------------------------------------- */

export function ParameterForm({
  predictionType, value, onChange
}: FormProps & { predictionType: string }) {
  switch (predictionType) {
    case "service_minutes": return <ServiceMinutesForm value={value} onChange={onChange} />;
    case "stop_demand":     return <StopDemandForm    value={value} onChange={onChange} />;
    default:
      return null;  // 非 OR 類型應已在上層 filter 掉，這裡防呆
  }
}

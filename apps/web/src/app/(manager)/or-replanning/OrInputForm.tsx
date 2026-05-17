"use client";

import * as React from "react";
import { Field, FieldGroup } from "@/components/form/Field";
import { NumberInput } from "@/components/form/NumberInput";
import { SelectInput } from "@/components/form/SelectInput";

export interface OrInputParams {
  service_minutes: { mean: number; p90: number };
  workload: { stops_per_driver_target: number; max_minutes_per_driver: number };
  objective: "minimize_total_minutes" | "minimize_distance" | "balance_load";
  vehicle_capacity_boxes: number;
}

export const DEFAULT_OR_INPUT: OrInputParams = {
  service_minutes: { mean: 10, p90: 14 },
  workload: { stops_per_driver_target: 28, max_minutes_per_driver: 480 },
  objective: "minimize_total_minutes",
  vehicle_capacity_boxes: 60
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
      <FieldGroup title="服務時間估算" description="OR 引擎排程時使用的平均服務時間">
        <Field label="平均服務時間" suffix="分鐘">
          <NumberInput
            value={value.service_minutes.mean}
            onChange={(n) => set("service_minutes", { ...value.service_minutes, mean: n })}
            min={0} disabled={readOnly}
          />
        </Field>
        <Field label="P90 服務時間" suffix="分鐘" hint="90% 的站會在這個時間內完成">
          <NumberInput
            value={value.service_minutes.p90}
            onChange={(n) => set("service_minutes", { ...value.service_minutes, p90: n })}
            min={0} disabled={readOnly}
          />
        </Field>
      </FieldGroup>

      <FieldGroup title="員工負荷限制" description="排程時每位物流士的工作量上限">
        <Field label="每人目標站數" suffix="站">
          <NumberInput
            value={value.workload.stops_per_driver_target}
            onChange={(n) => set("workload", { ...value.workload, stops_per_driver_target: n })}
            min={0} disabled={readOnly}
          />
        </Field>
        <Field label="每人工時上限" suffix="分鐘">
          <NumberInput
            value={value.workload.max_minutes_per_driver}
            onChange={(n) => set("workload", { ...value.workload, max_minutes_per_driver: n })}
            min={0} step={10} disabled={readOnly}
          />
        </Field>
      </FieldGroup>

      <FieldGroup title="目標與車輛設定">
        <Field label="優化目標">
          <SelectInput
            value={value.objective}
            onChange={(v) => set("objective", v as OrInputParams["objective"])}
            options={[
              { value: "minimize_total_minutes", label: "總工時最少" },
              { value: "minimize_distance",      label: "總里程最短" },
              { value: "balance_load",           label: "員工負擔均衡" }
            ]}
            disabled={readOnly}
          />
        </Field>
        <Field label="單台車容量" suffix="箱">
          <NumberInput
            value={value.vehicle_capacity_boxes}
            onChange={(n) => set("vehicle_capacity_boxes", n)}
            min={0} disabled={readOnly}
          />
        </Field>
      </FieldGroup>
    </div>
  );
}

/**
 * 將任意 JSON 物件（可能來自 DB 的舊資料）解析成 OrInputParams，
 * 缺欄位用 default 補。這樣 UI 不會被舊資料的格式差異弄壞。
 */
export function parseOrInputParams(raw: unknown): OrInputParams {
  const r = (raw ?? {}) as Record<string, any>;
  return {
    service_minutes: {
      mean: Number(r?.service_minutes?.mean ?? DEFAULT_OR_INPUT.service_minutes.mean),
      p90:  Number(r?.service_minutes?.p90  ?? DEFAULT_OR_INPUT.service_minutes.p90)
    },
    workload: {
      stops_per_driver_target: Number(
        r?.workload?.stops_per_driver_target ?? DEFAULT_OR_INPUT.workload.stops_per_driver_target
      ),
      max_minutes_per_driver: Number(
        r?.workload?.max_minutes_per_driver  ?? DEFAULT_OR_INPUT.workload.max_minutes_per_driver
      )
    },
    objective: (["minimize_total_minutes","minimize_distance","balance_load"]
                 .includes(r?.objective) ? r.objective : "minimize_total_minutes"),
    vehicle_capacity_boxes: Number(
      r?.vehicle_capacity_boxes ?? DEFAULT_OR_INPUT.vehicle_capacity_boxes
    )
  };
}

export const OBJECTIVE_LABEL: Record<OrInputParams["objective"], string> = {
  minimize_total_minutes: "總工時最少",
  minimize_distance: "總里程最短",
  balance_load: "員工負擔均衡"
};

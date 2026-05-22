import type { OnTimeBuckets } from "@/lib/services/quarterly-analysis-service";

/**
 * 把 OnTimeBuckets 畫成 donut：每段代表「準時率落在某 20% 區間」的個數。
 * 顏色從紅→橘→黃→淺綠→深綠，越右越好。
 */
const SEGMENTS: Array<{ key: keyof OnTimeBuckets; label: string; color: string }> = [
  { key: "b0_20",   label: "0–20%",   color: "#dc2626" }, // red-600
  { key: "b20_40",  label: "20–40%",  color: "#f97316" }, // orange-500
  { key: "b40_60",  label: "40–60%",  color: "#facc15" }, // yellow-400
  { key: "b60_80",  label: "60–80%",  color: "#84cc16" }, // lime-500
  { key: "b80_100", label: "80–100%", color: "#059669" }  // emerald-600
];

export function OnTimeBucketDonut({
  data, centerLabel
}: {
  data: OnTimeBuckets;
  /** donut 中央顯示的單位字（「位」/ 「家」） */
  centerLabel: string;
}) {
  const total = data.total;

  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const r = 72;
  const strokeW = 22;

  // 加權平均：把每個 bucket 視為中位數（0.1, 0.3, ...）算整體平均準時率
  const weightedAvg = (() => {
    if (total === 0) return 0;
    const mids = [0.1, 0.3, 0.5, 0.7, 0.9];
    let s = 0;
    SEGMENTS.forEach((seg, i) => { s += (data[seg.key] as number) * mids[i]; });
    return s / total;
  })();

  let cursor = 0;
  const arcs = SEGMENTS.map((seg) => {
    const v = data[seg.key] as number;
    const portion = total === 0 ? 0 : v / total;
    const startAngle = cursor;
    const endAngle = cursor + portion * 360;
    cursor = endAngle;
    return { ...seg, value: v, portion, startAngle, endAngle };
  });

  return (
    <div className="flex flex-col items-center gap-4 lg:flex-row lg:items-start lg:justify-around">
      <div className="relative shrink-0">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke="#f1f5f9"
            strokeWidth={strokeW}
          />
          {total > 0 && arcs.map((a, i) => {
            if (a.value === 0) return null;
            if (a.portion >= 0.9999) {
              return (
                <circle
                  key={i}
                  cx={cx} cy={cy} r={r}
                  fill="none"
                  stroke={a.color}
                  strokeWidth={strokeW}
                />
              );
            }
            return (
              <path
                key={i}
                d={describeArc(cx, cy, r, a.startAngle, a.endAngle)}
                fill="none"
                stroke={a.color}
                strokeWidth={strokeW}
                strokeLinecap="butt"
              />
            );
          })}
        </svg>

        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-xs text-slate-500">平均準時</div>
            <div className="mt-0.5 text-3xl font-semibold tabular-nums text-slate-900">
              {(weightedAvg * 100).toFixed(0)}%
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              {total} {centerLabel}
            </div>
          </div>
        </div>
      </div>

      <ul className="grid w-full grid-cols-2 gap-x-4 gap-y-1.5 text-sm lg:w-auto lg:grid-cols-1">
        {SEGMENTS.map((s) => {
          const v = data[s.key] as number;
          return (
            <li key={s.key} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: s.color }}
                />
                <span className="text-slate-600">{s.label}</span>
              </div>
              <span className="font-semibold tabular-nums text-slate-800">{v}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg <= 180 ? 0 : 1;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} ` +
         `A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

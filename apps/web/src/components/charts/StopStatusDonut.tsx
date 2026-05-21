import type { StatusBreakdown } from "@/lib/services/dashboard-service";

interface Segment {
  key: keyof StatusBreakdown;
  label: string;
  color: string;
}

const SEGMENTS: Segment[] = [
  { key: "completed",  label: "已完成", color: "#059669" }, // emerald-600
  { key: "arrived",    label: "已抵達", color: "#fb923c" }, // orange-400
  { key: "navigating", label: "導航中", color: "#fbbf24" }, // amber-400
  { key: "pending",    label: "待處理", color: "#cbd5e1" }, // slate-300
  { key: "failed",     label: "異常",   color: "#ef4444" }, // red-500
  { key: "skipped",    label: "略過",   color: "#a78bfa" }  // violet-400
];

/**
 * 站點狀態分佈 donut。
 *   - 中央顯示總站數 + 完成率
 *   - 右側 legend 顯示每個狀態的數量
 */
export function StopStatusDonut({ data }: { data: StatusBreakdown }) {
  const total = SEGMENTS.reduce((acc, s) => acc + (data[s.key] ?? 0), 0);

  const size = 180;
  const cx = size / 2;
  const cy = size / 2;
  const r = 72;
  const strokeW = 22;

  const completedRate = total === 0 ? 0 : ((data.completed ?? 0) / total) * 100;

  // 把每個 segment 用一段弧表示
  let cursor = 0;
  const arcs = SEGMENTS.map((s) => {
    const v = data[s.key] ?? 0;
    const portion = total === 0 ? 0 : v / total;
    const startAngle = cursor;
    const endAngle = cursor + portion * 360;
    cursor = endAngle;
    return { ...s, value: v, portion, startAngle, endAngle };
  });

  return (
    <div className="flex flex-col items-center gap-4 lg:flex-row lg:items-start lg:justify-around">
      <div className="relative shrink-0">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* 背景圈 */}
          <circle
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke="#f1f5f9"
            strokeWidth={strokeW}
          />
          {/* 各段弧 */}
          {total > 0 && arcs.map((a, i) => {
            if (a.value === 0) return null;
            // 處理「整圈」特殊情境
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
            const d = describeArc(cx, cy, r, a.startAngle, a.endAngle);
            return (
              <path
                key={i}
                d={d}
                fill="none"
                stroke={a.color}
                strokeWidth={strokeW}
                strokeLinecap="butt"
              />
            );
          })}
        </svg>

        {/* 中央文字 */}
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-xs text-slate-500">總站數</div>
            <div className="mt-0.5 text-3xl font-semibold tabular-nums text-slate-900">
              {total}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              完成 {completedRate.toFixed(1)}%
            </div>
          </div>
        </div>
      </div>

      {/* legend */}
      <ul className="grid w-full grid-cols-2 gap-x-4 gap-y-1.5 text-sm lg:w-auto lg:grid-cols-1">
        {SEGMENTS.map((s) => {
          const v = data[s.key] ?? 0;
          return (
            <li key={s.key} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: s.color }}
                />
                <span className="text-slate-600">{s.label}</span>
              </div>
              <span className="font-semibold tabular-nums text-slate-800">
                {v}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** polar → cartesian */
function polar(cx: number, cy: number, r: number, deg: number) {
  // 從 12 點鐘方向開始（角度 0 = 上方），順時針
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

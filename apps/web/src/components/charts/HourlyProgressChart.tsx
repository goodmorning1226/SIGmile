import type { HourlyPoint } from "@/lib/services/dashboard-service";

/**
 * 純 SVG area chart：顯示今日累計完成站數隨時間的成長
 * x 軸：06:00–22:00（17 小格）
 * y 軸：0 到目標完成站數
 */
export function HourlyProgressChart({
  data,
  totalStops
}: {
  data: HourlyPoint[];
  totalStops: number;
}) {
  // 圖表座標系
  const W = 760;          // viewBox 寬
  const H = 220;          // viewBox 高
  const padL = 36;        // 左邊保留給 y 軸 label
  const padR = 12;
  const padT = 14;
  const padB = 28;        // 底部 x 軸 label
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const maxY = Math.max(totalStops, 1, ...data.map((d) => d.cumulative));
  const x = (i: number) => padL + (i / Math.max(1, data.length - 1)) * innerW;
  const y = (v: number) => padT + innerH - (v / maxY) * innerH;

  // path
  const linePath = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.cumulative).toFixed(1)}`)
    .join(" ");
  const areaPath =
    `${linePath} L${x(data.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;

  // y 軸 ticks：0、25%、50%、75%、100%
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((p) => ({
    v: Math.round(maxY * p),
    yPos: y(maxY * p)
  }));

  // current completed
  const last = data[data.length - 1];
  const progress = last ? Math.round((last.cumulative / Math.max(1, totalStops)) * 100) : 0;

  return (
    <div className="w-full">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="text-3xl font-semibold tabular-nums text-slate-900">
          {last?.cumulative ?? 0}
          <span className="ml-1 text-base font-normal text-slate-500">/ {totalStops} 站</span>
        </span>
        <span className="text-sm font-medium text-brand-600 tabular-nums">{progress}%</span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[220px] w-full"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#fb923c" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#fb923c" stopOpacity="0.04" />
          </linearGradient>
        </defs>

        {/* y grid */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={padL} x2={W - padR} y1={t.yPos} y2={t.yPos}
              stroke="#e2e8f0" strokeWidth={1}
              strokeDasharray={i === 0 ? "0" : "3 3"}
            />
            <text
              x={padL - 6} y={t.yPos + 4}
              textAnchor="end"
              className="fill-slate-400"
              fontSize={10}
            >{t.v}</text>
          </g>
        ))}

        {/* x labels (每 2 小時一格) */}
        {data.map((d, i) => (
          i % 2 === 0 && (
            <text
              key={d.hour}
              x={x(i)}
              y={H - 8}
              textAnchor="middle"
              className="fill-slate-400"
              fontSize={10}
            >{String(d.hour).padStart(2, "0")}</text>
          )
        ))}

        {/* area */}
        <path d={areaPath} fill="url(#areaFill)" />
        {/* line */}
        <path
          d={linePath}
          fill="none"
          stroke="#ea580c"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* dot on last data point */}
        {last && (
          <g>
            <circle
              cx={x(data.length - 1)} cy={y(last.cumulative)}
              r={4} fill="#ea580c" stroke="#fff" strokeWidth={2}
            />
          </g>
        )}
      </svg>
    </div>
  );
}

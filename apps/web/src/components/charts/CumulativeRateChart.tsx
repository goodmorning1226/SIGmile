import type { HourlyPoint } from "@/lib/services/dashboard-service";

/**
 * 時段累積完成率 — 顯示「今日累計完成站 / 總站」隨時間的比率，
 * 並疊上一條「預期線性 (8 → 18)」做對照。
 *
 * 取代原本顯示絕對完成數的 HourlyProgressChart。
 */
export function CumulativeRateChart({
  data, totalStops
}: {
  data: HourlyPoint[];
  totalStops: number;
}) {
  const W = 760, H = 220, padL = 40, padR = 12, padT = 14, padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const N = data.length;

  if (N === 0 || totalStops === 0) {
    return <div className="py-8 text-center text-sm text-slate-500">尚無完成資料</div>;
  }

  const xAt = (i: number) => padL + (i / Math.max(1, N - 1)) * innerW;
  const yAt = (rate: number) => padT + (1 - Math.max(0, Math.min(1, rate))) * innerH;

  const actualPath = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(d.cumulative / totalStops).toFixed(1)}`)
    .join(" ");

  // 預期線：8:00 → 18:00 線性 (0 → 1)
  const expectedPath = data
    .map((d, i) => {
      const expected = Math.max(0, Math.min(1, (d.hour - 8) / 10));
      return `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(expected).toFixed(1)}`;
    })
    .join(" ");

  const last = data[N - 1];
  const actualRate = last.cumulative / totalStops;
  const expectedAtLast = Math.max(0, Math.min(1, (last.hour - 8) / 10));
  const deltaPp = (actualRate - expectedAtLast) * 100;
  const tone = deltaPp >= 0 ? "text-accent-600" : "text-red-600";

  return (
    <div className="w-full">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="text-3xl font-semibold tabular-nums text-slate-900">
          {(actualRate * 100).toFixed(1)}%
        </span>
        <span className="text-sm text-slate-500">
          已完成 {last.cumulative} / {totalStops} 站
        </span>
        <span className={`text-sm font-medium tabular-nums ${tone}`}>
          {deltaPp >= 0 ? "+" : ""}{deltaPp.toFixed(1)} pp vs 預期
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="h-[220px] w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="rateAreaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fb923c" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#fb923c" stopOpacity="0.04" />
          </linearGradient>
        </defs>

        {/* y grid 0/25/50/75/100% */}
        {[0, 0.25, 0.5, 0.75, 1].map((r, i) => (
          <g key={i}>
            <line
              x1={padL} x2={W - padR} y1={yAt(r)} y2={yAt(r)}
              stroke="#e2e8f0" strokeWidth={1}
              strokeDasharray={i === 0 ? "0" : "3 3"}
            />
            <text x={padL - 6} y={yAt(r) + 4} textAnchor="end" fontSize={10} className="fill-slate-400">
              {(r * 100).toFixed(0)}%
            </text>
          </g>
        ))}

        {/* x labels (每 2 小時) */}
        {data.map((d, i) =>
          i % 2 === 0 ? (
            <text key={d.hour} x={xAt(i)} y={H - 8} textAnchor="middle" fontSize={10} className="fill-slate-400">
              {String(d.hour).padStart(2, "0")}
            </text>
          ) : null
        )}

        {/* expected line */}
        <path d={expectedPath} fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 4" />

        {/* actual area */}
        <path d={`${actualPath} L${xAt(N - 1).toFixed(1)},${yAt(0).toFixed(1)} L${xAt(0).toFixed(1)},${yAt(0).toFixed(1)} Z`} fill="url(#rateAreaFill)" />

        {/* actual line */}
        <path d={actualPath} fill="none" stroke="#ea580c" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

        {/* dot on last */}
        <circle cx={xAt(N - 1)} cy={yAt(actualRate)} r={4} fill="#ea580c" stroke="#fff" strokeWidth={2} />

        {/* legend */}
        <g transform={`translate(${W - 170}, ${padT + 4})`}>
          <rect width={10} height={2} y={4} fill="#ea580c" />
          <text x={14} y={8} fontSize={10} className="fill-slate-500">實際累計完成率</text>
          <rect width={10} height={2} y={16} fill="#94a3b8" />
          <text x={14} y={20} fontSize={10} className="fill-slate-500">預期 (08 → 18 線性)</text>
        </g>
      </svg>
    </div>
  );
}

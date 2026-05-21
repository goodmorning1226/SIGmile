"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, XCircle, Play, RotateCcw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  generateScenario,
  runSweepPlusNN,
  runVRPTW,
  runHungarianRoundRobin,
  demoCheapestInsertion,
  runSelfCheck,
  type AlgorithmResult,
  type MockScenario,
  type InsertionDemo
} from "@/lib/services/or/test/or-test-cases";

const ALGO_LABEL = {
  sweep:     { label: "Sweep + NN + 2-opt", hint: "純距離 baseline (T9 + T1)" },
  vrptw:     { label: "VRPTW (Solomon)",     hint: "插入式時間窗排程 (T2)" },
  hungarian: { label: "Hungarian + Sweep",   hint: "戰略派工 + 戰術 (S2 + T9)" }
} as const;

type AlgoKey = keyof typeof ALGO_LABEL;

const COLORS = [
  "#f59e0b", "#10b981", "#3b82f6", "#ec4899",
  "#8b5cf6", "#f43f5e", "#06b6d4", "#84cc16",
  "#f97316", "#a855f7"
];

export function OrTestRunner() {
  const [numStops, setNumStops] = useState(20);
  const [numDrivers, setNumDrivers] = useState(4);
  const [seed, setSeed] = useState(42);
  const [twRatio, setTwRatio] = useState(0.3);
  const [algo, setAlgo] = useState<AlgoKey>("vrptw");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AlgorithmResult | null>(null);
  const [scenario, setScenario] = useState<MockScenario | null>(null);
  const [insertion, setInsertion] = useState<InsertionDemo | null>(null);
  const [selfCheck] = useState(() => runSelfCheck());

  const run = () => {
    startTransition(() => {
      const sc = generateScenario({
        num_stops: numStops,
        num_drivers: numDrivers,
        seed,
        tw_ratio: twRatio
      });
      setScenario(sc);
      let r: AlgorithmResult;
      switch (algo) {
        case "sweep":     r = runSweepPlusNN(sc); break;
        case "vrptw":     r = runVRPTW(sc); break;
        case "hungarian": r = runHungarianRoundRobin(sc); break;
      }
      setResult(r);
      // 額外跑 cheapest-insertion demo（取前 8 站當 base + 第 9 站當急件）
      if (sc.stops.length >= 10) {
        setInsertion(demoCheapestInsertion(sc, 8, 9));
      } else {
        setInsertion(null);
      }
    });
  };

  const reset = () => { setResult(null); setScenario(null); setInsertion(null); };

  return (
    <div className="space-y-6">
      {/* Self-check banner */}
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          {selfCheck.passed ? (
            <CheckCircle2 className="size-5 shrink-0 text-accent-600" />
          ) : (
            <XCircle className="size-5 shrink-0 text-red-600" />
          )}
          <div className="text-sm">
            <div className="font-semibold">
              啟動自檢 — {selfCheck.passed ? "全部通過" : "失敗"}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">
              {selfCheck.messages.join(" · ")}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle>1. 場景參數</CardTitle>
          <CardDescription>所有 case 都用 deterministic seed — 重跑會得到同樣結果。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <NumberCtrl label="停靠點數" value={numStops} onChange={setNumStops} min={3} max={80} step={1} />
            <NumberCtrl label="物流士數" value={numDrivers} onChange={setNumDrivers} min={1} max={10} step={1} />
            <NumberCtrl label="Random seed" value={seed} onChange={setSeed} min={0} max={9999} step={1} />
            <NumberCtrl label="時間窗比例" value={twRatio} onChange={setTwRatio} min={0} max={1} step={0.1} />
          </div>

          <div className="mt-4">
            <div className="text-sm font-medium text-slate-700">演算法</div>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(Object.keys(ALGO_LABEL) as AlgoKey[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setAlgo(k)}
                  className={
                    "rounded-lg border p-3 text-left transition " +
                    (algo === k
                      ? "border-brand-400 bg-brand-50"
                      : "border-slate-200 hover:bg-slate-50")
                  }
                >
                  <div className="text-sm font-semibold text-slate-900">{ALGO_LABEL[k].label}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{ALGO_LABEL[k].hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 flex gap-2">
            <Button onClick={run} loading={pending}>
              <Play className="size-4" /> 跑一次
            </Button>
            <Button variant="outline" onClick={reset} disabled={!result}>
              <RotateCcw className="size-4" /> 重置
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Result */}
      {result && scenario && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>2. 自動 Assertion</CardTitle>
              <CardDescription>
                {result.algorithm} · 耗時 {result.runtime_ms.toFixed(1)} ms · {result.scenario_name}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {result.assertions.map((a, i) => (
                  <li key={i} className="flex items-start gap-2">
                    {a.passed ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent-600" />
                    ) : (
                      <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
                    )}
                    <div>
                      <div className={a.passed ? "font-medium text-slate-800" : "font-medium text-red-700"}>
                        {a.name}
                      </div>
                      <div className="text-xs text-slate-500">{a.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3. 路線視覺化</CardTitle>
              <CardDescription>★ = depot；同色節點 = 同一位物流士負責；連線 = 拜訪順序。</CardDescription>
            </CardHeader>
            <CardContent>
              <RouteSVG result={result} scenario={scenario} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>4. 整體指標</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <MetricCell label="總里程" value={`${(result.metrics.total_distance_m / 1000).toFixed(1)} km`} />
                <MetricCell label="總工時 (Σ)" value={`${Math.round(result.metrics.total_minutes)} min`} />
                <MetricCell label="Makespan" value={`${Math.round(result.metrics.makespan_min)} min`} hint="最晚下班那位的工時" />
                <MetricCell label="工時 σ" value={`${result.metrics.workload_stddev.toFixed(1)} min`} hint="越小越公平" />
                <MetricCell label="使用物流士" value={`${result.metrics.drivers_used} / ${scenario.drivers.length}`} />
                <MetricCell label="超載 driver" value={String(result.metrics.capacity_violation)}
                  bad={result.metrics.capacity_violation > 0} />
                <MetricCell label="違反時間窗" value={String(result.metrics.tw_violation)}
                  bad={result.metrics.tw_violation > 0} />
                <MetricCell label="未指派 stops" value={String(result.unassigned.length)}
                  bad={result.unassigned.length > 0} />
              </div>
              {result.unassigned.length > 0 && (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <div className="font-semibold">未指派：</div>
                  <div className="mt-1">{result.unassigned.join(", ")}</div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>5. 每位物流士明細</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {result.routes.map((r, i) => (
                  <div
                    key={r.driver_id}
                    className="rounded-md border border-slate-200 bg-slate-50/40 p-3"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block size-3 rounded-full"
                        style={{ backgroundColor: COLORS[i % COLORS.length] }}
                      />
                      <span className="font-semibold text-slate-900">{r.driver_id}</span>
                      <span className="text-xs text-slate-500">
                        {r.stop_ids.length} 站 · {r.total_demand} 箱 ·
                        {" "}{(r.total_distance_m / 1000).toFixed(1)} km ·
                        {" "}{Math.round(r.total_minutes)} min
                      </span>
                      {r.late_stops.length > 0 && (
                        <span className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-red-600">
                          <AlertTriangle className="size-3" /> {r.late_stops.length} late
                        </span>
                      )}
                    </div>
                    {r.stop_ids.length > 0 && (
                      <div className="mt-2 text-xs text-slate-600">
                        {r.stop_ids.join(" → ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {insertion && (
            <Card>
              <CardHeader>
                <CardTitle>6. Cheapest-Insertion 急件 demo</CardTitle>
                <CardDescription>
                  把第 9 個 stop 當「急件」插進原本 8 站的 route — 找到最便宜插入位置。
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <MetricCell label="原 route 長度" value={`${(insertion.base_length_m / 1000).toFixed(2)} km`} />
                  <MetricCell label="插入後長度" value={`${(insertion.new_length_m / 1000).toFixed(2)} km`} />
                  <MetricCell
                    label="Δ cost"
                    value={`+${(insertion.delta_cost_m / 1000).toFixed(2)} km`}
                    hint={`插在第 ${insertion.insertion_index + 1} 站之後`}
                  />
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
                  <div className="rounded-md border border-slate-200 bg-slate-50/40 p-2">
                    <div className="mb-1 font-semibold text-slate-700">原 route：</div>
                    <div className="text-slate-600">{insertion.base_route.join(" → ")}</div>
                  </div>
                  <div className="rounded-md border border-brand-200 bg-brand-50/40 p-2">
                    <div className="mb-1 font-semibold text-brand-700">
                      插入 {insertion.inserted_stop} 後：
                    </div>
                    <div className="text-slate-700">
                      {insertion.new_route.map((id, i) => (
                        <span key={i}>
                          <span className={id === insertion.inserted_stop ? "font-semibold text-brand-700" : ""}>
                            {id}
                          </span>
                          {i < insertion.new_route.length - 1 && " → "}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function NumberCtrl({
  label, value, onChange, min, max, step
}: { label: string; value: number; onChange: (n: number) => void; min: number; max: number; step: number }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="flex-1 accent-brand-500"
        />
        <span className="w-12 text-right text-sm tabular-nums text-slate-900">
          {step < 1 ? value.toFixed(1) : value}
        </span>
      </div>
    </label>
  );
}

function MetricCell({
  label, value, hint, bad
}: { label: string; value: string; hint?: string; bad?: boolean }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${bad ? "text-red-600" : "text-slate-900"}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

function RouteSVG({ result, scenario }: { result: AlgorithmResult; scenario: MockScenario }) {
  const bbox = useMemo(() => {
    let minLat = scenario.depot.lat, maxLat = scenario.depot.lat;
    let minLng = scenario.depot.lng, maxLng = scenario.depot.lng;
    for (const s of scenario.stops) {
      minLat = Math.min(minLat, s.lat); maxLat = Math.max(maxLat, s.lat);
      minLng = Math.min(minLng, s.lng); maxLng = Math.max(maxLng, s.lng);
    }
    const padLat = (maxLat - minLat) * 0.1 || 0.01;
    const padLng = (maxLng - minLng) * 0.1 || 0.01;
    return { minLat: minLat - padLat, maxLat: maxLat + padLat, minLng: minLng - padLng, maxLng: maxLng + padLng };
  }, [scenario]);

  const W = 720, H = 480;
  const project = (lat: number, lng: number): [number, number] => {
    const x = ((lng - bbox.minLng) / (bbox.maxLng - bbox.minLng)) * W;
    const y = H - ((lat - bbox.minLat) / (bbox.maxLat - bbox.minLat)) * H;
    return [x, y];
  };

  const [dx, dy] = project(scenario.depot.lat, scenario.depot.lng);
  const stopMap = new Map(scenario.stops.map((s) => [s.id, s]));

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-full rounded-md border border-slate-200 bg-white"
        style={{ aspectRatio: `${W} / ${H}` }}
      >
        {/* Grid */}
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={`gx${i}`} x1={i * W / 4} y1={0} x2={i * W / 4} y2={H}
            stroke="#f1f5f9" strokeWidth={1} />
        ))}
        {[0, 1, 2, 3].map((i) => (
          <line key={`gy${i}`} x1={0} y1={i * H / 3} x2={W} y2={i * H / 3}
            stroke="#f1f5f9" strokeWidth={1} />
        ))}

        {/* Routes */}
        {result.routes.map((r, i) => {
          if (r.stop_ids.length === 0) return null;
          const color = COLORS[i % COLORS.length];
          const points: Array<[number, number]> = [];
          points.push([dx, dy]); // depot start
          for (const id of r.stop_ids) {
            const s = stopMap.get(id);
            if (s) points.push(project(s.lat, s.lng));
          }
          points.push([dx, dy]); // depot end
          const path = points.map(([x, y], idx) => `${idx === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
          return (
            <path key={r.driver_id} d={path} fill="none" stroke={color}
              strokeWidth={1.8} strokeOpacity={0.7} strokeLinecap="round" />
          );
        })}

        {/* Stops */}
        {result.routes.map((r, i) => {
          const color = COLORS[i % COLORS.length];
          return r.stop_ids.map((id, k) => {
            const s = stopMap.get(id);
            if (!s) return null;
            const [x, y] = project(s.lat, s.lng);
            return (
              <g key={`${r.driver_id}-${id}`}>
                <circle cx={x} cy={y} r={9} fill={color} stroke="white" strokeWidth={2} />
                <text x={x} y={y + 3.5} textAnchor="middle" fontSize={9} fill="white" fontWeight={700}>
                  {k + 1}
                </text>
              </g>
            );
          });
        })}

        {/* Unassigned stops in grey */}
        {result.unassigned.map((id) => {
          const s = stopMap.get(id);
          if (!s) return null;
          const [x, y] = project(s.lat, s.lng);
          return (
            <g key={`u-${id}`}>
              <circle cx={x} cy={y} r={7} fill="#cbd5e1" stroke="white" strokeWidth={2} />
              <text x={x} y={y + 3} textAnchor="middle" fontSize={8} fill="#475569">×</text>
            </g>
          );
        })}

        {/* Depot ★ */}
        <g>
          <circle cx={dx} cy={dy} r={14} fill="#0f172a" stroke="white" strokeWidth={2} />
          <text x={dx} y={dy + 5} textAnchor="middle" fontSize={14} fill="#fbbf24" fontWeight={700}>★</text>
        </g>
      </svg>
    </div>
  );
}

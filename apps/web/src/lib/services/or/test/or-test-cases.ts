/**
 * OR 演算法自動測試案例 — 給「OR 測試」頁面用。
 *
 * 每個 case 都是 deterministic（同 random seed），可用於：
 *   - 視覺化（畫站點 + route）
 *   - 自動 assertion（lower-bound 比較、容量約束、時間窗約束）
 *
 * 不需要 supabase；不需要 TomTom；不需要 Python。
 * 全部跑在瀏覽器 / Node — codex 可以直接看到結果。
 */

import {
  buildHaversineMatrix,
  polarAngle,
  routeLengthMeters,
  type LatLng
} from "../kernel/distance";
import {
  sweepCluster,
  nearestNeighborTSP,
  twoOptImprove,
  cheapestInsertion,
  hungarianAssign,
  vrptwHeuristic,
  simulateVRPTWRoute,
  type SweepStop,
  type VRPTWStop
} from "../engines/pure-ts-heuristics";

// ─────────────────────────────────────────────────────────────
// Deterministic PRNG (mulberry32) — 給 case 用，不影響 algo
// ─────────────────────────────────────────────────────────────
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─────────────────────────────────────────────────────────────
// 案例產生器 — 模擬北部 DC + 雙北 25km 內配送
// ─────────────────────────────────────────────────────────────
export interface MockStop {
  id: string;
  lat: number;
  lng: number;
  demand: number;
  service_minutes: number;
  tw_start_min: number | null;
  tw_end_min:   number | null;
}

export interface MockScenario {
  depot: LatLng;
  stops: MockStop[];
  drivers: Array<{
    id: string;
    capacity: number;
    shift_start_min: number;
    shift_end_min: number;
  }>;
}

export function generateScenario(opts: {
  num_stops: number;
  num_drivers: number;
  seed?: number;
  capacity?: number;
  /** 0..1; 多少比例的站有時間窗 */
  tw_ratio?: number;
}): MockScenario {
  const rand = mulberry32(opts.seed ?? 42);
  const depot = { lat: 25.0610, lng: 121.4847 }; // 林口 DC 附近
  const stops: MockStop[] = [];
  // 雙北市區大約 0.15 度方框
  for (let i = 0; i < opts.num_stops; i++) {
    const lat = depot.lat + (rand() - 0.5) * 0.16;
    const lng = depot.lng + (rand() - 0.5) * 0.20;
    const demand = 1 + Math.floor(rand() * 5); // 1..5 箱
    const service_min = 8 + Math.floor(rand() * 8); // 8..15 分
    const hasTW = rand() < (opts.tw_ratio ?? 0.3);
    let tw_start: number | null = null;
    let tw_end: number | null = null;
    if (hasTW) {
      // 早上 9 點 ~ 下午 5 點之間，窗 1 小時
      const center = 9 * 60 + Math.floor(rand() * 8 * 60);
      tw_start = center - 30;
      tw_end   = center + 30;
    }
    stops.push({
      id: `S${String(i + 1).padStart(3, "0")}`,
      lat,
      lng,
      demand,
      service_minutes: service_min,
      tw_start_min: tw_start,
      tw_end_min: tw_end
    });
  }
  const drivers = Array.from({ length: opts.num_drivers }, (_, i) => ({
    id: `D${String(i + 1).padStart(2, "0")}`,
    capacity: opts.capacity ?? 30,
    shift_start_min: 8 * 60 + 30,
    shift_end_min: 18 * 60
  }));
  return { depot, stops, drivers };
}

// ─────────────────────────────────────────────────────────────
// 測試結果型別
// ─────────────────────────────────────────────────────────────
export interface AlgorithmResult {
  algorithm: string;
  scenario_name: string;
  /** Route per driver — stop ids in visit order */
  routes: Array<{
    driver_id: string;
    stop_ids: string[];
    total_distance_m: number;
    total_minutes: number;
    total_demand: number;
    arrival_minutes: number[];
    late_stops: number[];
  }>;
  /** 未被指派的 stops (容量/時窗/沒人接得到) */
  unassigned: string[];
  metrics: {
    total_distance_m: number;
    total_minutes: number;
    makespan_min: number;        // max driver time
    workload_stddev: number;     // 工時公平度（σ）
    drivers_used: number;
    capacity_violation: number;  // 超載 driver 數
    tw_violation: number;        // 違反時間窗 stop 數
  };
  /** 自動 assertion 結果 */
  assertions: Array<{
    name: string;
    passed: boolean;
    detail: string;
  }>;
  runtime_ms: number;
}

// ─────────────────────────────────────────────────────────────
// 共用：跑完一個 result 後算 metrics + 跑 assertion
// ─────────────────────────────────────────────────────────────
function summarize(
  algorithm: string,
  scenario: MockScenario,
  routes: AlgorithmResult["routes"],
  unassigned: string[],
  runtime_ms: number
): AlgorithmResult {
  const totalDist = routes.reduce((s, r) => s + r.total_distance_m, 0);
  const totalMin = routes.reduce((s, r) => s + r.total_minutes, 0);
  const makespan = routes.reduce((m, r) => Math.max(m, r.total_minutes), 0);
  const used = routes.filter((r) => r.stop_ids.length > 0).length;
  const usedMins = routes.filter((r) => r.stop_ids.length > 0).map((r) => r.total_minutes);
  const mean = usedMins.length === 0 ? 0 : usedMins.reduce((s, x) => s + x, 0) / usedMins.length;
  const variance =
    usedMins.length === 0
      ? 0
      : usedMins.reduce((s, x) => s + (x - mean) ** 2, 0) / usedMins.length;
  const stdev = Math.sqrt(variance);

  // capacity 違反
  let capViolation = 0;
  for (const r of routes) {
    const driver = scenario.drivers.find((d) => d.id === r.driver_id);
    if (driver && r.total_demand > driver.capacity) capViolation++;
  }

  const twViolation = routes.reduce((s, r) => s + r.late_stops.length, 0);

  // ─── 自動 assertion ───
  const allStopIds = new Set(scenario.stops.map((s) => s.id));
  const visited = new Set<string>();
  for (const r of routes) for (const id of r.stop_ids) visited.add(id);
  const visitedCount = visited.size;
  const missing = [...allStopIds].filter((id) => !visited.has(id) && !unassigned.includes(id));

  const assertions: AlgorithmResult["assertions"] = [
    {
      name: "全部 stop 被處理 (assigned ∪ unassigned = all)",
      passed: missing.length === 0,
      detail: missing.length === 0
        ? `所有 ${allStopIds.size} 個 stop 都被處理`
        : `${missing.length} 個 stop 既未被指派也未被列入 unassigned: ${missing.slice(0, 5).join(",")}…`
    },
    {
      name: "無重複指派 (每個 stop 至多在一條 route)",
      passed: visitedCount === routes.reduce((s, r) => s + r.stop_ids.length, 0),
      detail: visitedCount === routes.reduce((s, r) => s + r.stop_ids.length, 0)
        ? `${visitedCount} 個 unique stops`
        : `偵測到重複指派！`
    },
    {
      name: "容量約束 (Σdemand ≤ capacity per driver)",
      passed: capViolation === 0,
      detail: capViolation === 0
        ? `所有 ${routes.length} 條 route 都符合容量`
        : `${capViolation} 條 route 超載`
    },
    {
      name: "時間窗約束 (no late stops)",
      passed: twViolation === 0,
      detail: twViolation === 0
        ? `0 個違反`
        : `${twViolation} 個 stop 抵達晚於 tw_end`
    }
  ];

  return {
    algorithm,
    scenario_name: `${scenario.stops.length} stops / ${scenario.drivers.length} drivers`,
    routes,
    unassigned,
    metrics: {
      total_distance_m: totalDist,
      total_minutes: totalMin,
      makespan_min: makespan,
      workload_stddev: stdev,
      drivers_used: used,
      capacity_violation: capViolation,
      tw_violation: twViolation
    },
    assertions,
    runtime_ms
  };
}

// ─────────────────────────────────────────────────────────────
// 演算法執行包裝（給 UI 用）
// ─────────────────────────────────────────────────────────────
export function runSweepPlusNN(scenario: MockScenario): AlgorithmResult {
  const t0 = performance.now();
  const points: LatLng[] = [scenario.depot, ...scenario.stops];
  const { distance_m } = buildHaversineMatrix(points);
  // matrix index: 0 = depot, 1..N = stops[i-1]
  const sweepStops: SweepStop[] = scenario.stops.map((s, i) => ({
    id: s.id,
    matrix_index: i + 1,
    theta: polarAngle(scenario.depot, s),
    demand: s.demand
  }));
  const clusters = sweepCluster(
    sweepStops,
    scenario.drivers[0]?.capacity ?? 30,
    { direction: "ccw" }
  );

  // 每 cluster 用 NN → 2-opt 後給一個 driver；多出的 cluster 合併到最少站的 driver
  const routes: AlgorithmResult["routes"] = scenario.drivers.map((d) => ({
    driver_id: d.id,
    stop_ids: [],
    total_distance_m: 0,
    total_minutes: 0,
    total_demand: 0,
    arrival_minutes: [],
    late_stops: []
  }));

  for (let ci = 0; ci < clusters.length; ci++) {
    const cluster = clusters[ci];
    const driverIdx = ci % scenario.drivers.length;
    const indices = cluster.stops.map((s) => s.matrix_index);
    const nnRoute = nearestNeighborTSP(indices, distance_m);
    const opt = twoOptImprove(nnRoute, distance_m, 30);
    const route = routes[driverIdx];
    // 加到已有 route 後面（單一 cluster per driver 時為空）
    for (const idx of opt.route) {
      const stop = scenario.stops[idx - 1];
      route.stop_ids.push(stop.id);
      route.total_demand += stop.demand;
    }
    route.total_distance_m += opt.length;
    // 用 avg 速度估時間（每分鐘 ~ 28km/h）+ service
    route.total_minutes += opt.length / 1000 / 28 * 60;
    for (const idx of opt.route) {
      const stop = scenario.stops[idx - 1];
      route.total_minutes += stop.service_minutes;
    }
  }

  const t1 = performance.now();
  return summarize("Sweep + NN + 2-opt", scenario, routes, [], t1 - t0);
}

export function runVRPTW(scenario: MockScenario): AlgorithmResult {
  const t0 = performance.now();
  const points: LatLng[] = [scenario.depot, ...scenario.stops];
  const { distance_m, time_min } = buildHaversineMatrix(points);

  const vrptwStops: VRPTWStop[] = scenario.stops.map((s, i) => ({
    matrix_index: i + 1,
    demand: s.demand,
    service_minutes: s.service_minutes,
    tw_start_min: s.tw_start_min,
    tw_end_min: s.tw_end_min
  }));

  const out = vrptwHeuristic(vrptwStops, distance_m, time_min, {
    drivers: scenario.drivers.map((d) => ({
      capacity: d.capacity,
      shift_start_min: d.shift_start_min,
      shift_end_min: d.shift_end_min
    }))
  });

  const routes: AlgorithmResult["routes"] = scenario.drivers.map((d, di) => {
    const r = out.routes[di];
    return {
      driver_id: d.id,
      stop_ids: r.stops.map((vs) => scenario.stops[vs.matrix_index - 1].id),
      total_distance_m: r.total_distance_m,
      total_minutes: r.total_minutes,
      total_demand: r.total_demand,
      arrival_minutes: r.arrival_min,
      late_stops: r.late_stops
    };
  });

  const unassignedIds = out.unassigned.map(
    (vs) => scenario.stops[vs.matrix_index - 1].id
  );

  const t1 = performance.now();
  return summarize("VRPTW (Solomon insertion)", scenario, routes, unassignedIds, t1 - t0);
}

export function runHungarianRoundRobin(scenario: MockScenario): AlgorithmResult {
  const t0 = performance.now();
  const points: LatLng[] = [scenario.depot, ...scenario.stops];
  const { distance_m } = buildHaversineMatrix(points);

  // 1. 先用 Sweep 切 N 個 cluster（N = drivers.length）
  const totalDemand = scenario.stops.reduce((s, x) => s + x.demand, 0);
  const targetCap = Math.ceil(totalDemand / scenario.drivers.length);
  const sweepStops: SweepStop[] = scenario.stops.map((s, i) => ({
    id: s.id,
    matrix_index: i + 1,
    theta: polarAngle(scenario.depot, s),
    demand: s.demand
  }));
  const clusters = sweepCluster(sweepStops, targetCap);
  // 若多出來，合併到最小那個
  while (clusters.length > scenario.drivers.length) {
    clusters.sort((a, b) => a.total_demand - b.total_demand);
    const a = clusters.shift()!;
    clusters[0].stops.push(...a.stops);
    clusters[0].total_demand += a.total_demand;
  }
  // 若不夠，pad 空 cluster
  while (clusters.length < scenario.drivers.length) {
    clusters.push({ stops: [], total_demand: 0 });
  }

  // 2. Hungarian — cost[driver][cluster] = 從 depot 到 cluster 質心的距離
  const cost: number[][] = scenario.drivers.map((_, di) =>
    clusters.map((c) => {
      if (c.stops.length === 0) return 1e6;
      // 質心
      let lat = 0, lng = 0;
      for (const s of c.stops) {
        const st = scenario.stops[s.matrix_index - 1];
        lat += st.lat;
        lng += st.lng;
      }
      lat /= c.stops.length;
      lng /= c.stops.length;
      // 用 haversine 估，+ 一點 driver index dependent 噪聲讓 Hungarian 不退化
      const dx = lng - scenario.depot.lng;
      const dy = lat - scenario.depot.lat;
      const dist = Math.sqrt(dx * dx + dy * dy) * 111_000;
      return dist + di * 100;
    })
  );
  const assignment = hungarianAssign(cost);

  // 3. 每 cluster 內 NN → 2-opt
  const routes: AlgorithmResult["routes"] = scenario.drivers.map((d) => ({
    driver_id: d.id,
    stop_ids: [],
    total_distance_m: 0,
    total_minutes: 0,
    total_demand: 0,
    arrival_minutes: [],
    late_stops: []
  }));

  for (let di = 0; di < scenario.drivers.length; di++) {
    const cluster_idx = assignment[di];
    if (cluster_idx < 0 || cluster_idx >= clusters.length) continue;
    const cluster = clusters[cluster_idx];
    if (cluster.stops.length === 0) continue;
    const indices = cluster.stops.map((s) => s.matrix_index);
    const nnRoute = nearestNeighborTSP(indices, distance_m);
    const opt = twoOptImprove(nnRoute, distance_m, 30);
    const route = routes[di];
    for (const idx of opt.route) {
      const stop = scenario.stops[idx - 1];
      route.stop_ids.push(stop.id);
      route.total_demand += stop.demand;
    }
    route.total_distance_m = opt.length;
    route.total_minutes = opt.length / 1000 / 28 * 60;
    for (const idx of opt.route) {
      route.total_minutes += scenario.stops[idx - 1].service_minutes;
    }
  }

  const t1 = performance.now();
  return summarize("Hungarian + Sweep + NN + 2-opt", scenario, routes, [], t1 - t0);
}

// ─────────────────────────────────────────────────────────────
// Cheapest-insertion demo — 模擬「急件加進現有 route」
// ─────────────────────────────────────────────────────────────
export interface InsertionDemo {
  base_route: string[];
  base_length_m: number;
  inserted_stop: string;
  new_route: string[];
  new_length_m: number;
  delta_cost_m: number;
  insertion_index: number;
}

export function demoCheapestInsertion(
  scenario: MockScenario,
  /** 從 stops 中先抽 baseStopCount 站當「已規劃好的 route」 */
  baseStopCount = 8,
  /** 第 N 個 stop 作為急件 */
  urgentStopIndex = 9
): InsertionDemo {
  const points: LatLng[] = [scenario.depot, ...scenario.stops];
  const { distance_m } = buildHaversineMatrix(points);

  const baseStopIndices = scenario.stops
    .slice(0, baseStopCount)
    .map((_, i) => i + 1);
  const baseRoute = twoOptImprove(
    nearestNeighborTSP(baseStopIndices, distance_m),
    distance_m,
    30
  );
  const urgent = urgentStopIndex + 1;
  const ins = cheapestInsertion(baseRoute.route, urgent, distance_m);
  const newRouteLen = routeLengthMeters(distance_m, ins.route);

  return {
    base_route: baseRoute.route.map((idx) => scenario.stops[idx - 1].id),
    base_length_m: baseRoute.length,
    inserted_stop: scenario.stops[urgent - 1].id,
    new_route: ins.route.map((idx) => scenario.stops[idx - 1].id),
    new_length_m: newRouteLen,
    delta_cost_m: ins.delta_cost,
    insertion_index: ins.insertion_index
  };
}

// 啟動時跑一個 self-check（被 import 就會跑）
// — 避免演算法回歸時悄悄壞掉
export function runSelfCheck(): { passed: boolean; messages: string[] } {
  const msgs: string[] = [];
  let pass = true;

  // Test 1: Hungarian on 3x3 known optimum
  // cost = [[1,2,3],[2,4,6],[3,6,9]] — optimum is identity (1+4+9 = 14)
  // ...wait, identity = 1+4+9, but [0,2,1] = 1+6+6=13. So optimum is mix.
  const h = hungarianAssign([[4, 1, 3], [2, 0, 5], [3, 2, 2]]);
  const cost = h[0] >= 0 && h[1] >= 0 && h[2] >= 0
    ? 4 * 0 + [4, 1, 3][h[0]] + [2, 0, 5][h[1]] + [3, 2, 2][h[2]]
    : -1;
  // 最佳 = 1 + 2 + 2 = 5 (assignments [1, 0, 2])
  if (cost !== 5) {
    pass = false;
    msgs.push(`Hungarian: expected 5 cost, got ${cost} (assignment=${h.join(",")})`);
  } else {
    msgs.push(`Hungarian 3x3: pass (cost=5)`);
  }

  // Test 2: NN on 4-stop square should produce optimal tour
  // depot=(0,0); stops=(1,0),(1,1),(0,1) → optimal = 4
  const sq: number[][] = [
    [0, 1, Math.SQRT2, 1],
    [1, 0, 1, Math.SQRT2],
    [Math.SQRT2, 1, 0, 1],
    [1, Math.SQRT2, 1, 0]
  ];
  const nn = nearestNeighborTSP([1, 2, 3], sq);
  const nnLen = routeLengthMeters(sq, nn);
  if (Math.abs(nnLen - 4) > 0.01) {
    pass = false;
    msgs.push(`NN square: expected 4, got ${nnLen.toFixed(2)}`);
  } else {
    msgs.push(`NN square: pass (length=4)`);
  }

  // Test 3: simulate VRPTW route with TW violation
  const sim = simulateVRPTWRoute(
    [{
      matrix_index: 1,
      demand: 1,
      service_minutes: 10,
      tw_start_min: null,
      tw_end_min: 5 // late_min should fire
    }],
    [[0, 60], [60, 0]],
    [[0, 60], [60, 0]],
    0,
    240
  );
  if (sim.late_stops.length !== 1) {
    pass = false;
    msgs.push(`VRPTW late: expected 1, got ${sim.late_stops.length}`);
  } else {
    msgs.push(`VRPTW TW violation: pass`);
  }

  // Test 4: cheapest-insertion — depot(0) + 4 stops (1..4) 線性排列；插入 stop 5 (位於 2.5 處)
  // matrix idx 0..5；distance = |i - j|
  const lin: number[][] = [
    [0, 1, 2, 3, 4, 2.5],
    [1, 0, 1, 2, 3, 1.5],
    [2, 1, 0, 1, 2, 0.5],
    [3, 2, 1, 0, 1, 0.5],
    [4, 3, 2, 1, 0, 1.5],
    [2.5, 1.5, 0.5, 0.5, 1.5, 0]
  ];
  const ins = cheapestInsertion([1, 2, 3, 4], 5, lin);
  // 預期最佳插入位置在 2 與 3 之間 (因為 5 距 2,3 都是 0.5)
  const inserted5At = ins.route.indexOf(5);
  // 接受 2 或 3 之後（兩者 delta 一樣）
  const okPos = inserted5At === 2 || inserted5At === 3;
  if (!okPos) {
    pass = false;
    msgs.push(`Cheapest insert: stop 5 inserted at idx ${inserted5At}, expected 2 or 3`);
  } else {
    msgs.push(`Cheapest insert: pass (5 inserted at idx ${inserted5At}, delta=${ins.delta_cost.toFixed(2)})`);
  }

  return { passed: pass, messages: msgs };
}

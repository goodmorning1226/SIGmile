"""
SIGmile · OR engine JSON wrapper.

讀 stdin (JSON) → 跑 Gurobi MTVRP → 寫 stdout (JSON)。
Next.js API 用 child_process.spawn 呼叫:
    python or-engine/solver_main.py < input.json > output.json

Input JSON schema:
{
  "depot":   {"id": "dc-tpe", "lat": 25.04, "lng": 121.48},
  "stops":   [
    {"id": "stop-1", "lat": 25.0, "lng": 121.5,
     "demand": 12, "service_minutes": 10, "shift": 1}
  ],
  "drivers": [
    {"id": "p1", "shift": 1, "capacity": 60,
     "max_minutes": 600, "overtime_threshold": 480}
  ],
  "tau": [[0, 5, 10], [5, 0, 3], [10, 3, 0]],   // (n+1) x (n+1); index 0 = depot
  "weights": {"alpha": 1.0, "beta": 300.0, "gamma": 1.5},
  "num_trips": 2,
  "time_limit_sec": 60,
  "mip_gap": 0.05
}

Output JSON schema:
{
  "ok": true,
  "status": 9,
  "objective": 1037.3,
  "best_bound": 975.15,
  "gap": 0.0599,
  "runtime_sec": 180.3,
  "drivers_used": 2,
  "drivers": [
    {"id": "p1", "total_work_minutes": 271.4, "overtime_minutes": 0.0, "dispatched": true}
  ],
  "routes": [
    {
      "driver_id": "p1",
      "trip_index": 1,
      "start_minute": 0.0,
      "end_minute": 270.5,
      "trip_drive_minutes": 168.8,
      "trip_service_minutes": 102.6,
      "trip_total_demand": 248,
      "stops": [
        {"stop_id": "stop-1", "stop_order": 1,
         "arrival_minute": 0.4, "service_minutes": 10, "demand": 12}
      ]
    }
  ],
  "unassigned_stops": []
}

On failure (gurobipy 沒裝、license 失效、infeasible):
{
  "ok": false,
  "error": "...",
  "error_kind": "missing_dependency|infeasible|no_solution|runtime"
}
"""

from __future__ import annotations

import json
import sys
import traceback


def _fail(kind: str, msg: str):
    print(json.dumps({"ok": False, "error_kind": kind, "error": msg}))
    sys.exit(0)  # exit 0 so caller reads stdout normally


def main():
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            _fail("runtime", "empty stdin")
        try:
            data = json.loads(raw)
        except Exception as e:
            _fail("runtime", f"invalid JSON: {e}")
    except Exception as e:
        _fail("runtime", f"stdin read failed: {e}")
        return

    # ---- lazy import so missing dep gives a clean JSON error ----
    try:
        from vrp_gurobi import solve_mtvrp, extract_routes
    except Exception as e:
        _fail(
            "missing_dependency",
            f"gurobipy/vrp_gurobi import failed: {e}. "
            "Install with `pip install -r or-engine/requirements.txt` and ensure Gurobi license is configured.",
        )
        return

    try:
        stops = data["stops"]
        drivers = data["drivers"]
        tau_matrix = data["tau"]
        weights = data.get("weights", {})
        alpha   = float(weights.get("alpha",   1.0))      # 工時成本
        beta    = float(weights.get("beta",    300.0))    # 派工成本
        gamma   = float(weights.get("gamma",   1.5))      # 加班成本
        delta_w = float(weights.get("delta_w", 0.0))      # 工時不平衡懲罰
        delta_b = float(weights.get("delta_b", 0.0))      # 箱數不平衡懲罰
        num_trips = int(data.get("num_trips", 2))
        time_limit = int(data.get("time_limit_sec", 60))
        mip_gap = float(data.get("mip_gap", 0.05))
        big_M = float(data.get("big_M", 10000))

        n_total = 1 + len(stops)  # depot + customers
        if len(tau_matrix) != n_total or any(len(row) != n_total for row in tau_matrix):
            _fail("runtime",
                  f"tau matrix size {len(tau_matrix)} mismatches depot+stops {n_total}")
            return

        N = list(range(n_total))
        depot = 0

        # tau dict
        tau = {(i, j): float(tau_matrix[i][j]) for i in N for j in N}

        # sigma (service minutes) — depot=0, customer index = 1..n
        sigma = {0: 0.0}
        for k, s in enumerate(stops, start=1):
            sigma[k] = float(s.get("service_minutes", 10))

        # q (demand)
        q = {0: 0}
        for k, s in enumerate(stops, start=1):
            q[k] = int(s.get("demand", 1) or 1)

        # shift_node
        shift_node = {}
        for k, s in enumerate(stops, start=1):
            shift_node[k] = int(s.get("shift", 1) or 1)

        # drivers
        P = [d["id"] for d in drivers]
        shift_driver = {d["id"]: int(d.get("shift", 1) or 1) for d in drivers}
        # capacity: per-driver dict
        capacity = {d["id"]: int(d.get("capacity", 60) or 60) for d in drivers}
        # H_bar / H
        H_bar = {d["id"]: float(d.get("max_minutes", 600) or 600) for d in drivers}
        H = {d["id"]: float(d.get("overtime_threshold", d.get("max_minutes", 480)) or 480)
             for d in drivers}

        R = tuple(range(1, num_trips + 1))

        # ---- solve ----
        model, vars_ = solve_mtvrp(
            P=P, N=N, depot=depot, R=R,
            tau=tau, sigma=sigma, q=q,
            shift_node=shift_node, shift_driver=shift_driver,
            capacity=capacity, H_bar=H_bar, H=H,
            alpha=alpha, beta=beta, gamma=gamma,
            delta_w=delta_w, delta_b=delta_b,
            M=big_M, time_limit_s=time_limit, mip_gap=mip_gap,
        )

        if model.SolCount == 0:
            print(json.dumps({
                "ok": False,
                "error_kind": "no_solution",
                "error": f"No solution found. status={model.Status}",
            }))
            return

        routes_raw = extract_routes(model, vars_, P, N, R, depot)
        u = vars_["u"]; W = vars_["W"]; O = vars_["O"]
        T = vars_["T"]; Ts = vars_["Ts"]; Te = vars_["Te"]
        B = vars_["B"]; W_max = vars_["W_max"]; W_min = vars_["W_min"]
        B_max = vars_["B_max"]; B_min = vars_["B_min"]

        idx_to_stop = {0: None}
        for k, s in enumerate(stops, start=1):
            idx_to_stop[k] = s["id"]

        out_drivers = []
        for p in P:
            out_drivers.append({
                "id": p,
                "dispatched": bool(u[p].X > 0.5),
                "total_work_minutes": float(W[p].X),
                "overtime_minutes": float(O[p].X),
                "total_boxes": float(B[p].X),
            })

        out_routes = []
        for p in P:
            if u[p].X < 0.5:
                continue
            for r in R:
                seq = routes_raw.get((p, r))
                if not seq or len(seq) <= 2:
                    continue
                trip_drive = 0.0
                trip_service = 0.0
                trip_demand = 0
                stops_out = []
                for k in range(len(seq) - 1):
                    i, j = seq[k], seq[k + 1]
                    trip_drive += tau[(i, j)]
                    if i != depot:
                        trip_service += sigma[i]
                # build stops in order (skip depot endpoints)
                order = 1
                for node in seq[1:-1]:
                    trip_demand += q[node]
                    stops_out.append({
                        "stop_id": idx_to_stop[node],
                        "stop_order": order,
                        "arrival_minute": float(T[node].X),
                        "service_minutes": float(sigma[node]),
                        "demand": int(q[node]),
                    })
                    order += 1
                out_routes.append({
                    "driver_id": p,
                    "trip_index": int(r),
                    "start_minute": float(Ts[p, r].X),
                    "end_minute": float(Te[p, r].X),
                    "trip_drive_minutes": float(trip_drive),
                    "trip_service_minutes": float(trip_service),
                    "trip_total_demand": int(trip_demand),
                    "stops": stops_out,
                })

        result = {
            "ok": True,
            "status": int(model.Status),
            "objective": float(model.ObjVal),
            "best_bound": float(model.ObjBound),
            "gap": float(model.MIPGap),
            "runtime_sec": float(model.Runtime),
            "drivers_used": int(sum(1 for p in P if u[p].X > 0.5)),
            "drivers": out_drivers,
            "routes": out_routes,
            "unassigned_stops": [],
            # 平衡指標（給 UI 顯示「最忙最閒差距」）
            "balance": {
                "work_min_range": float(W_max.X - W_min.X),
                "work_min_max":   float(W_max.X),
                "work_min_min":   float(W_min.X),
                "box_range":      float(B_max.X - B_min.X),
                "box_max":        float(B_max.X),
                "box_min":        float(B_min.X),
            },
        }
        print(json.dumps(result))

    except Exception as e:
        tb = traceback.format_exc()
        _fail("runtime", f"{e}\n{tb}")


if __name__ == "__main__":
    main()

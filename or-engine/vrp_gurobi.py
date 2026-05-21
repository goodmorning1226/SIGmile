"""
Multi-Trip VRP — Gurobi implementation of OR_formulation.tex

This file is the SAME solver as OR/vrp_gurobi.py — copied into the engine
package so the web backend can spawn it as a subprocess without depending
on the /OR folder layout.

Sets / params follow the TeX exactly:
  P  drivers (one driver = one vehicle)
  N  all stops; index 0 = depot. customers = N \\ {0}
  R  trips per driver, {1, 2}

Variables
  x[i,j,p,r] in {0,1}    driver p on trip r traverses arc i->j
  y[i,p,r]   in {0,1}    customer i served by (p, r)
  u[p]       in {0,1}    driver p is dispatched
  T[i]       >= 0        arrival time at i (one per node, per the TeX)
  W[p]       >= 0        total work minutes of driver p
  O[p]       >= 0        overtime minutes of driver p
  B[p]       >= 0        total boxes per driver
  W_max/min  >= 0        workload range (over dispatched drivers)
  B_max/min  >= 0        box-count range (over dispatched drivers)

Auxiliary (introduced by (J), not formally listed in the TeX)
  Ts[p,r]    >= 0        trip r start time (depot departure)
  Te[p,r]    >= 0        trip r end time   (depot return)
"""

from __future__ import annotations

import gurobipy as gp
from gurobipy import GRB


def solve_mtvrp(
    *,
    P,            # iterable of driver ids
    N,            # iterable of node ids, must include depot
    depot,        # depot id (typically 0)
    R,            # iterable of trip indices, e.g. (1, 2)
    tau,          # dict (i,j) -> minutes
    sigma,        # dict i -> service minutes
    q,            # dict i -> demand (depot demand = 0)
    shift_node,   # dict i -> shift int (1=day, 2=night); depot can be None/any
    shift_driver, # dict p -> shift int
    capacity,     # Q (scalar) OR dict p -> capacity
    H_bar,        # dict p -> max minutes
    H,            # dict p -> overtime threshold
    alpha, beta, gamma,
    delta_w=0.0,  # penalty weight on max(W_p) - min(W_p) over dispatched drivers
    delta_b=0.0,  # penalty weight on max(B_p) - min(B_p) over dispatched drivers
    M=10_000,
    time_limit_s=300,
    mip_gap=0.05,
):
    customers = [i for i in N if i != depot]

    m = gp.Model("mtvrp")
    m.Params.TimeLimit = time_limit_s
    m.Params.MIPGap = mip_gap

    # ---------- variables ----------
    x = m.addVars(N, N, P, R, vtype=GRB.BINARY, name="x")
    y = m.addVars(N, P, R, vtype=GRB.BINARY, name="y")
    u = m.addVars(P, vtype=GRB.BINARY, name="u")
    T = m.addVars(N, vtype=GRB.CONTINUOUS, lb=0.0, name="T")
    W = m.addVars(P, vtype=GRB.CONTINUOUS, lb=0.0, name="W")
    O = m.addVars(P, vtype=GRB.CONTINUOUS, lb=0.0, name="O")
    Ts = m.addVars(P, R, vtype=GRB.CONTINUOUS, lb=0.0, name="Ts")
    Te = m.addVars(P, R, vtype=GRB.CONTINUOUS, lb=0.0, name="Te")
    # Per-driver box total + max/min for balance penalties
    B = m.addVars(P, vtype=GRB.CONTINUOUS, lb=0.0, name="B")
    W_max = m.addVar(vtype=GRB.CONTINUOUS, lb=0.0, name="W_max")
    W_min = m.addVar(vtype=GRB.CONTINUOUS, lb=0.0, name="W_min")
    B_max = m.addVar(vtype=GRB.CONTINUOUS, lb=0.0, name="B_max")
    B_min = m.addVar(vtype=GRB.CONTINUOUS, lb=0.0, name="B_min")

    for i in N:
        for p in P:
            for r in R:
                x[i, i, p, r].UB = 0

    for i in customers:
        si = shift_node[i]
        for p in P:
            if shift_driver[p] != si:
                for r in R:
                    y[i, p, r].UB = 0
                    for j in N:
                        x[i, j, p, r].UB = 0
                        x[j, i, p, r].UB = 0

    for p in P:
        for r in R:
            y[depot, p, r].UB = 0

    T_UB = max(H_bar.values())
    for i in customers:
        T[i].UB = T_UB
    for p in P:
        for r in R:
            Ts[p, r].UB = T_UB
            Te[p, r].UB = T_UB

    # ---------- objective ----------
    travel = gp.quicksum(
        (tau[i, j] + sigma[i]) * x[i, j, p, r]
        for p in P for r in R for i in N for j in N
    )
    m.setObjective(
        alpha * travel
        + beta * gp.quicksum(u[p] for p in P)
        + gamma * gp.quicksum(O[p] for p in P)
        + delta_w * (W_max - W_min)
        + delta_b * (B_max - B_min),
        GRB.MINIMIZE,
    )

    # ---------- constraints ----------
    for i in customers:
        m.addConstr(gp.quicksum(y[i, p, r] for p in P for r in R) == 1,
                    name=f"A_serve_{i}")

    for i in customers:
        for p in P:
            for r in R:
                m.addConstr(gp.quicksum(x[i, j, p, r] for j in N) == y[i, p, r],
                            name=f"B_out_{i}_{p}_{r}")
                m.addConstr(gp.quicksum(x[j, i, p, r] for j in N) == y[i, p, r],
                            name=f"B_in_{i}_{p}_{r}")

    for p in P:
        for r in R:
            m.addConstr(gp.quicksum(x[depot, j, p, r] for j in customers) <= 1,
                        name=f"C_out_{p}_{r}")
            m.addConstr(gp.quicksum(x[i, depot, p, r] for i in customers) <= 1,
                        name=f"C_in_{p}_{r}")
            m.addConstr(
                gp.quicksum(x[depot, j, p, r] for j in customers)
                == gp.quicksum(x[i, depot, p, r] for i in customers),
                name=f"C_balance_{p}_{r}",
            )

    for i in customers:
        for j in customers:
            if i == j:
                continue
            for p in P:
                for r in R:
                    m.addConstr(
                        T[j] >= T[i] + sigma[i] + tau[i, j] - M * (1 - x[i, j, p, r]),
                        name=f"D_mtz_{i}_{j}_{p}_{r}",
                    )

    for p in P:
        m.addConstr(
            W[p] == gp.quicksum(
                (tau[i, j] + sigma[i]) * x[i, j, p, r]
                for r in R for i in N for j in N
            ),
            name=f"E_work_{p}",
        )

    for p in P:
        m.addConstr(W[p] <= H_bar[p], name=f"F_maxH_{p}")
    for p in P:
        m.addConstr(O[p] >= W[p] - H[p], name=f"G_OT_{p}")
    for p in P:
        m.addConstr(W[p] <= M * u[p], name=f"H_disp_{p}")

    for p in P:
        for r in R:
            for i in customers:
                m.addConstr(
                    Te[p, r] >= T[i] + sigma[i] + tau[i, depot]
                    - M * (1 - x[i, depot, p, r]),
                    name=f"J_end_{p}_{r}_{i}",
                )
            for j in customers:
                m.addConstr(
                    T[j] >= Ts[p, r] + tau[depot, j] - M * (1 - x[depot, j, p, r]),
                    name=f"J_start_{p}_{r}_{j}",
                )
    R_list = list(R)
    for p in P:
        for k in range(len(R_list) - 1):
            r_prev, r_next = R_list[k], R_list[k + 1]
            m.addConstr(Ts[p, r_next] >= Te[p, r_prev], name=f"J_link_{p}_{r_prev}_{r_next}")

    # (K) vehicle capacity per trip — capacity 可以是 scalar 或 dict
    def cap_of(p):
        if isinstance(capacity, dict):
            return capacity.get(p, 0)
        return capacity

    for p in P:
        for r in R:
            m.addConstr(
                gp.quicksum(q[i] * y[i, p, r] for i in customers) <= cap_of(p),
                name=f"K_cap_{p}_{r}",
            )

    # (N) Workload balance — penalize max(W_p) - min(W_p) over dispatched drivers
    for p in P:
        m.addConstr(W_max >= W[p], name=f"N_Wmax_{p}")
        # When u_p = 0 (idle), big-M relaxes the lower-bound-on-min constraint
        m.addConstr(W_min <= W[p] + M * (1 - u[p]), name=f"N_Wmin_{p}")

    # (O) Box-count balance — B_p = total boxes per driver across all trips
    for p in P:
        m.addConstr(
            B[p] == gp.quicksum(q[i] * y[i, p, r] for r in R for i in customers),
            name=f"O_B_{p}",
        )
        m.addConstr(B_max >= B[p], name=f"O_Bmax_{p}")
        m.addConstr(B_min <= B[p] + M * (1 - u[p]), name=f"O_Bmin_{p}")

    m.optimize()
    return m, dict(x=x, y=y, u=u, T=T, W=W, O=O, Ts=Ts, Te=Te,
                   B=B, W_max=W_max, W_min=W_min, B_max=B_max, B_min=B_min)


def extract_routes(model, vars_, P, N, R, depot):
    if model.SolCount == 0:
        return {}
    x = vars_["x"]
    routes = {}
    for p in P:
        for r in R:
            nxt = {}
            for i in N:
                for j in N:
                    if x[i, j, p, r].X > 0.5:
                        nxt[i] = j
            if depot not in nxt:
                continue
            seq = [depot]
            cur = depot
            while True:
                nxt_node = nxt.get(cur)
                if nxt_node is None or nxt_node == depot:
                    seq.append(depot)
                    break
                seq.append(nxt_node)
                cur = nxt_node
                if len(seq) > len(N) + 2:
                    break
            routes[(p, r)] = seq
    return routes

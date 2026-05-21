# SIGmile

物流配送管理系統 · MVP

橘色主、綠色次的配色，主管端 Next.js Web 後台 + 物流士端 Flutter App + Supabase Postgres + RLS + Bearer JWT。
**OR 路線規劃** 串接 Python Gurobi MTVRP solver、**Driver app** 串接 TomTom 真實導航與多站路線、AI 分析仍為 mock 介面（已包好可替換）。

---

## 倉庫結構

```
SIGmile/
├── apps/
│   ├── web/                  # Next.js 15 主管端後台 + 系統 backend API
│   └── driver_app/           # Flutter 物流士端 App（Web / Android / 真機）
├── or-engine/                # Python Gurobi MTVRP solver（JSON stdin/stdout 包裝）
│   ├── solver_main.py        # JSON 入口
│   ├── vrp_gurobi.py         # MTVRP 模型
│   ├── requirements.txt      # gurobipy
│   └── README.md             # 安裝與設定
├── supabase/
│   ├── migrations/           # PG schema + RLS + indexes + Phase 2 OR 欄位
│   └── seed/                 # demo seed（4 支依序跑 + nuke 清空工具）
├── .vscode/
│   └── launch.json.example   # 把這檔 copy 成 launch.json 並填入自己的 keys
├── DEMO.md                   # 端到端 demo 操作手冊
└── README.md
```

---

## 從 clone 到跑起來（10 分鐘）

### 1) Supabase 專案

到 https://supabase.com 開一個新專案，記下三個值：
- Project URL
- `anon` public key
- `service_role` secret key

到 SQL Editor 按時間順序跑下面 3 支 migration：

1. [`supabase/migrations/20260517000000_init_schema.sql`](supabase/migrations/20260517000000_init_schema.sql) — schema / enums / indexes / 初版 RLS
2. [`supabase/migrations/20260518000000_fix_rls_recursion.sql`](supabase/migrations/20260518000000_fix_rls_recursion.sql) — 修 42P17 遞迴
3. [`supabase/migrations/20260521000000_or_phase2_fields.sql`](supabase/migrations/20260521000000_or_phase2_fields.sql) — Phase 2 OR 對齊欄位（班別 / 溫層 / 一日二配 / 路線集）

### 2) Next.js Web 後台

```powershell
cd apps/web
cp .env.local.example .env.local
# 編輯 .env.local，填 NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY
# （選用）填 TOMTOM_API_KEY 啟用真實路徑時間矩陣
npm install
npm run dev
```

啟動訊息看到：

```
- Local:   http://localhost:3000
- Network: http://10.x.x.x:3000
```

兩行都出現代表 `-H 0.0.0.0` 生效（Android 模擬器 / Flutter Web 才能連到）。

### 3) Flutter 物流士 App

```powershell
cp .vscode/launch.json.example .vscode/launch.json
# 編輯 .vscode/launch.json 填 SUPABASE_URL / SUPABASE_ANON_KEY / TOMTOM_API_KEY
```

VS Code Run and Debug 面板選 config：

| Config | 適用情境 | API_BASE_URL |
|---|---|---|
| **driver_app (Web · Chrome)** | 最方便，跑 Chrome | `http://localhost:3000` |
| **driver_app (Android emulator)** | Android 模擬器 | `http://10.0.2.2:3000` |
| **driver_app (physical device / WiFi)** | 真機，同 WiFi | PC 區網 IP，例如 `http://192.168.1.20:3000` |

按 F5 啟動。Android emulator 路徑首次需要先：

```powershell
cd apps/driver_app
flutter create . --platforms=android --project-name=sigmile_driver
# 編輯 android/app/src/main/AndroidManifest.xml 的 <application> 加 android:usesCleartextTraffic="true"
```

### 4)（選用）OR engine — 想跑真實 Gurobi MTVRP

```powershell
cd or-engine
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

裝完後 Next.js **會自動偵測** `or-engine/.venv/Scripts/python.exe` 並使用，不用改 `.env.local`，只要重啟 dev server。Gurobi license（學術 / 商業均可）需先設好。

沒裝也行 — 「Gurobi 試算」按鈕會 fallback 跑內建 mock，並把原因（python 沒裝 / gurobipy import 失敗 / infeasible…）彈窗顯示給你看。

詳見 [`or-engine/README.md`](or-engine/README.md)。

### 5) 建 demo 帳號 + seed 資料

照 [DEMO.md](DEMO.md) §1 步驟：
- Supabase Auth 建 7 個帳號（1 manager + 6 driver）
- 依序跑 3 支 seed SQL（`demo_seed.sql` → `demo_seed_phase2.sql` → `demo_seed_phase3_mvp.sql`）

---

## Logo 圖檔擺放位置

- `apps/web/public/logo.png` — 後台 sidebar / login / favicon
- `apps/driver_app/assets/images/logo.png` — App login / Today AppBar

兩個檔可以是同一張。沒放也能跑，只是看不到 logo。

---

## 主要技術

| 層 | 技術 |
|---|---|
| 主管後台 + 系統 API | Next.js 15 (App Router) + TypeScript + Tailwind |
| 物流士 App | Flutter 3.22+ · Riverpod 2 · go_router 14 |
| 地圖 + 導航 | **TomTom Maps + Routing Matrix v1 API**（Web + Driver app 都用） |
| OR 路線規劃 | **Python Gurobi MTVRP**（subprocess JSON I/O；TS 端有 mock fallback） |
| 資料庫 | Supabase Postgres + Row Level Security |
| 認證 | Supabase Auth · Bearer JWT（mobile/Web）/ Session cookie（manager 後台） |
| 仍 Mock 的服務 | AI 分析、AI 參數預測（介面已包好可替換） |

---

## 已實作功能

**主管端**
- **今日總覽 Dashboard**：6 個 KPI cards + 每小時完成進度 / 站點狀態 donut / 物流士排行 + AI 分析按鈕
- **物流士管理**：
  - 主檔卡片顯示啟用人數
  - 「新增物流士」表單（自動建 auth user + profile + 顯示初始密碼）
  - Excel 下載 / 上傳（依 Email upsert，新建者初始密碼可整批複製）
  - 卡片包含「今日無任務」狀態（idle）
- **物流士 detail**：地圖佔位 + 停靠點時間軸 + 上下排序
- **發布新路線（OR 規劃）**：
  - 步驟 0 · 停靠點主檔 Excel I/O
  - 步驟 1 · 規劃參數（α/β 權重、預設容量、一日趟次）
  - 步驟 2 · 試算（**Mock** 內建快速 / **Gurobi** 真實求解）+ 結果預覽
  - 試算結果可「採用此結果」存為草稿、或「採用並發布」直接上線
- **路線集**（OR 跑完產生的路線集合，原「停靠點分群」）：
  - 草稿 / 已發布 tab 切換有 optimistic UI（即時反饋）
  - 草稿可改名 / 拖動 stop 順序 / 跨群移動 / 合併拆分
  - 草稿頁有「發布此草稿」按鈕（會自動建今日 delivery_tasks）
- **物流士分配**：每條路線集（R-001…）對應指派的物流士，可下拉換人（含 shift / 容量 / 溫層 mismatch 警告）
- **路線歷史**：依期間 / 狀態 / 物流士搜尋的版本檢視器
- **AI 分析歷史**：所有分析結果條列檢視

**物流士端**
- 登入（角色檢查：非 driver 拒絕）
- 今日任務頁：問候 + 進度卡 + 目前 / 下一站 + **第 N 趟徽章**（一日二配）
- 停靠點清單頁：依 trip_index 分組顯示「第 1 趟 / 第 2 趟」分隔
- 目前站點：開啟導航 / 已抵達 / 完成配送 / 回報異常
- **TomTom 真實導航**：App 內地圖 + 多站路線 + turn-by-turn 指令 banner + 車道引導 + 語音播報
- 異常回報：6 種原因 + 備註

**整合保留接點**
- [apps/web/src/lib/services/ai-service.ts](apps/web/src/lib/services/ai-service.ts) — 換真實 AI 模型只動這檔
- [apps/web/src/lib/services/or-planning-service.ts](apps/web/src/lib/services/or-planning-service.ts) — 增加 `RealORPlanningService` 來換不同 solver
- [apps/web/src/lib/services/tomtom-matrix-service.ts](apps/web/src/lib/services/tomtom-matrix-service.ts) — 換其他 routing 供應商只動這檔
- [or-engine/solver_main.py](or-engine/solver_main.py) — 自己接其他 solver（OR-Tools / Pyomo / …）只要保持 JSON I/O contract

---

## 文件索引

- **[DEMO.md](DEMO.md)** — 端到端 demo 流程 + KPI 對照表 + 故障排除 + 開發工具 SQL
- **[or-engine/README.md](or-engine/README.md)** — Gurobi 安裝 + Python venv 自動偵測 + 環境變數
- **[apps/web/README.md](apps/web/README.md)** — 主管後台細節
- **[apps/driver_app/README.md](apps/driver_app/README.md)** — 物流士 App 細節 + TomTom 設定

---

## 安全提醒

- `.env.local` 與 `.vscode/launch.json` 都已被 `.gitignore` 排除，**含 Supabase keys / TomTom keys 的檔案不會進 repo**
- `/OR/` 公司原始資料夾（PDF / Excel）也在 `.gitignore`
- `supabase/migrations/` 用 RLS 限制 driver 只能讀寫自己的 task；manager 可全讀
- 後端有可選的 `ALLOW_DEV_DRIVER` 開發 fallback（只在 `NODE_ENV != production` 生效），詳見 [apps/web/.env.local.example](apps/web/.env.local.example)

---

## 開發工具

- **重置所有路線資料**：[`supabase/seed/nuke_route_plans.sql`](supabase/seed/nuke_route_plans.sql) — 一鍵清空所有 route_plans + driver_clusters + driver_route_assignments + route_stops + delivery_tasks + or_planning_jobs（idempotent，包在 transaction）
- **TypeScript 嚴格檢查**：`cd apps/web && npx tsc --noEmit`
- **Flutter 分析**：`cd apps/driver_app && flutter analyze`

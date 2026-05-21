# SIGmile · Demo 操作手冊

> 目標：從零到一跑出「主管 + 多位物流士」端到端流程，含 KPI 圖表、AI 分析、**OR 路線規劃（Gurobi）**、路線集編輯、物流士分配、發布上線、物流士現場配送與 TomTom 真實導航。
>
> 你需要 **三個分頁 / 視窗**：
>   1. 主管後台（Next.js Web，`http://localhost:3000`）
>   2. 物流士 A 的 App（Flutter Web Chrome 或 Android emulator）
>   3. Supabase Dashboard（建帳號 / 看資料）

---

## 0. 前置條件

- 已有 Supabase 專案（記下 Project URL、anon key、service_role key）
- 已申請 **TomTom Developer API key**（地圖 + 導航 + duration matrix；https://developer.tomtom.com/ 免費註冊）
- Node 20+、npm（或 pnpm / yarn）
- Flutter stable
- VS Code（建議）
- 已 clone 本 repo
- **（選用，跑真實 Gurobi OR 才需要）** Python 3.10+、Gurobi license（學術 / 商業）

---

## 1. 一次性初始化

### 1.1 跑 schema + RLS 修補 + Phase 2

Supabase Dashboard → SQL Editor，按順序貼下面三支：

1. [`supabase/migrations/20260517000000_init_schema.sql`](supabase/migrations/20260517000000_init_schema.sql) — schema / enums / indexes / 初版 RLS / 基礎 seed
2. [`supabase/migrations/20260518000000_fix_rls_recursion.sql`](supabase/migrations/20260518000000_fix_rls_recursion.sql) — 修 42P17 遞迴
3. [`supabase/migrations/20260521000000_or_phase2_fields.sql`](supabase/migrations/20260521000000_or_phase2_fields.sql) — Phase 2 OR 對齊欄位（班別 / 溫層 / 一日二配 / 路線集 / driver_clusters 表）

> 看到 `[seed] 請先在 Supabase Auth 建立 driver1 / driver2 …已跳過 8.2` 是預期行為。

### 1.2 建 demo 帳號

Dashboard → Authentication → Users → **Add user** 建 7 個（勾「Auto Confirm User」）：

| Email | Password 建議 | 角色 | 用途 |
|---|---|---|---|
| `manager@example.com` | `sigmile-demo-2026` | manager | 主管後台登入 |
| `driver1@example.com` | `sigmile-demo-2026` | driver | App 登入 / OR 派工 |
| `driver2@example.com` | `sigmile-demo-2026` | driver | App 登入 / OR 派工 |
| `driver3@example.com` | `sigmile-demo-2026` | driver | OR 派工（日班） |
| `driver4@example.com` | `sigmile-demo-2026` | driver | OR 派工（日班） |
| `driver5@example.com` | `sigmile-demo-2026` | driver | OR 派工(夜班) |
| `driver6@example.com` | `sigmile-demo-2026` | driver | OR 派工（夜班） |

driver3 ~ 6 不一定要登入 App，只是讓 OR engine 有更多人可分配，能跑出多條路線。
**之後也可以從主管後台「物流士」頁直接新增**，不用每次回 Supabase Dashboard 建。

### 1.3 取得 UUID

SQL Editor：

```sql
select id, email from auth.users
 where email like '%@example.com'
 order by email;
```

只有 driver1 / driver2 / manager 的 UUID 要填進 `demo_seed.sql`；driver3 ~ 6 在 `demo_seed_phase3_mvp.sql` 用 email 自動查，不用手填。

### 1.4 跑 demo seed（3 支依序）

#### 1.4.1 [`supabase/seed/demo_seed.sql`](supabase/seed/demo_seed.sql)
打開檔，把開頭 `DO $$` block 內：

```sql
manager_id  uuid := '00000000-0000-0000-0000-000000000099';
driver_1_id uuid := '00000000-0000-0000-0000-000000000001';
driver_2_id uuid := '00000000-0000-0000-0000-000000000002';
```

換成 §1.3 查出來的真實 UUID。整檔貼到 SQL Editor → Run。看到：

```
[demo] DONE. plan=..., task1=..., task2=..., or_job=...
```

即成功。

#### 1.4.2 [`supabase/seed/demo_seed_phase2.sql`](supabase/seed/demo_seed_phase2.sql)
補齊 phase2 欄位 + 加 3 個 stops + 建一個 draft route_plan（給「路線集」/「物流士分配」頁示範草稿狀態）。
**不用改 UUID**（會自動沿用 phase1 同樣的 UUID）。

#### 1.4.3 [`supabase/seed/demo_seed_phase3_mvp.sql`](supabase/seed/demo_seed_phase3_mvp.sql)
用 email 自動查 driver3 ~ 6 → upsert profile + 加 15 個 stops（日 9 + 夜 6，貨量壓低到 4-7 確保 OR 跑得起來）。
**不用改 UUID**（用 email 查）。

3 支全部 idempotent，可重跑。

### 1.5 啟 Next.js 後台

```powershell
cd apps/web
cp .env.local.example .env.local
# 編輯 .env.local：
#   1. 必填 NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY
#   2. 強烈建議 TOMTOM_API_KEY（沒設會用 haversine 估算，OR 時間不真實）
npm install
npm run dev
```

啟動訊息要兩行：

```
- Local:   http://localhost:3000
- Network: http://10.x.x.x:3000
```

打開 `http://localhost:3000` → 用 `manager@example.com` 登入 → 看到 Dashboard 即成功。

### 1.6 啟 Flutter App

```powershell
# 在 repo 根目錄
cp .vscode/launch.json.example .vscode/launch.json
# 編輯 .vscode/launch.json 填 SUPABASE_URL / SUPABASE_ANON_KEY / TOMTOM_API_KEY
```

**Web 路徑（最快）**：VS Code Run and Debug → 選 **driver_app (Web · Chrome)** → F5。

**Android emulator 路徑**：

```powershell
cd apps/driver_app
flutter create . --platforms=android --project-name=sigmile_driver
# 編輯 android/app/src/main/AndroidManifest.xml 的 <application> 加 android:usesCleartextTraffic="true"
flutter pub get
```

回 VS Code 選 **driver_app (Android emulator)** → F5。

App 開啟 → 用 `driver1@example.com` 登入 → 看到「今日配送」即成功。

### 1.7（選用）安裝 Gurobi OR engine

要按「Gurobi 試算」按鈕跑真實求解：

```powershell
cd or-engine
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
# 確認 license 有效
.\.venv\Scripts\python.exe -c "import gurobipy; print(gurobipy.gurobi.version())"
```

裝完後 Next.js **會自動偵測** `or-engine/.venv/Scripts/python.exe`，不用改 `.env.local`，只要 **重啟** dev server。詳見 [`or-engine/README.md`](or-engine/README.md)。

沒裝也行 — 按鈕還是按得下去，系統會 fallback 跑 mock 並彈窗顯示 diagnostics（python 路徑、stderr 等）。

### 1.8（選用）放 logo 圖檔

- `apps/web/public/logo.png` — 後台 sidebar / login / favicon
- `apps/driver_app/assets/images/logo.png` — App login / Today AppBar

兩個可以是同一張。沒放也能跑，只是看不到 logo。

---

## 2. Demo flow（建議 15 分鐘）

> 跑 demo 前若已有舊資料，先跑 [`supabase/seed/nuke_route_plans.sql`](supabase/seed/nuke_route_plans.sql) 清空所有 plan / cluster / 任務（不會動 stops / drivers 主檔）。

### 步驟 A · 主管端 Dashboard 起手

1. Manager 登入 → 進 `/dashboard`
2. 應看到：
   - 6 個 KPI cards 數字全為 0
   - **「每小時完成進度」** area chart — 平的
   - **「站點狀態分佈」** donut chart — 全部「待處理」灰色
   - **「物流士進度排行」** — 王小明、李小華 0%
3. 解說：「現在還沒發布任何路線，所以今天沒任務」

### 步驟 B · 物流士管理（UI 取代 SQL）

1. 側欄點 **「物流士」**
2. 看到「物流士主檔」卡片：**目前共 6 位啟用中**（phase3 已建好）
3. 想再加一位 demo 用：
   - 右上 **「新增物流士」** → 填 email / 姓名 / 班別 / 容量 → 建立 → 跳出含初始密碼的卡片（**一次性顯示**，要立刻複製給司機）
   - 或下載 Excel → 加 row → 上傳 → 一次新增多人，新建者密碼整批顯示 + 一鍵複製
4. 下方卡片區看到每位 driver 目前是「今日無任務」灰色徽章

### 步驟 C · 跑 OR 路線規劃

側欄點 **「發布新路線」**：

1. **步驟 0 · 停靠點資料**：目前有 23 站，可下載 Excel 改完上傳灌回（demo 可略過）
2. **步驟 1 · 規劃參數**：展開可調 α（時間成本）/ β（派工成本，越小越分散）/ 預設容量 / 一日趟次（1 or 2）
3. 右上 **「建立新規劃任務」** → 跳 modal → 建立 → 任務列表新增 `pending`
4. 任務卡片有兩個試算按鈕：
   - **Mock 試算**：秒回（按 city × shift 切群；demo / 沒裝 Gurobi 時用）
   - **Gurobi 試算**：呼叫 Python solver，10 秒 ~ 數分鐘
   - 過程中會用 TomTom 算 (depot + N stop) × (depot + N stop) **真實**行車時間矩陣
5. 試算完成顯示「出動物流士 / 路線集 / 總站數 / 預估總工時」+ engine 標籤（`gurobi-v1` 綠色 / `mock-v1` 藍色）
6. 點 **「明細」** → 看「規劃條件」+ 「試算結果」每條 R-001 / R-002… 路線集，含第 1 趟 / 第 2 趟 stops
7. 結果滿意 → 兩個選擇：
   - **「採用此結果」** → 存為草稿（可在 /clusters /assignment 微調）
   - **「採用並發布」** → 直接上線，舊版自動 archived，自動建今日 delivery_tasks

### 步驟 D · 路線集 / 物流士分配（微調草稿）

側欄點 **「路線集」**：

1. tab 切「草稿」/「已發布」（**切換 tab 有 optimistic UI + loading spinner**，即時回饋）
2. 草稿頁上方有橘色 **「發布此草稿」** banner
3. 編輯區可改 cluster 名稱、拖 stop 順序、跨群移動、合併 / 拆分
4. 已發布頁是 read-only banner

側欄點 **「物流士分配」**：

1. 看每條路線集（R-001 …）目前指派給誰
2. 下拉換人；發布時會檢查 shift / 容量 / 溫層 mismatch（紅字警告）

### 步驟 E · 發布草稿 → 任務生效

回 /clusters 草稿 tab → 按 **「發布此草稿」** → 二次確認 → 彈窗：

```
✅ 已發布第 N 版
自動建立 X 個物流士的今日任務。
可到「物流士」頁查看派送狀態。
```

側欄回 **「物流士」**：6 張卡片從「今日無任務」變成「待處理」+ 進度 0/N

### 步驟 F · 物流士 A 開始配送

切到 Driver1 App：

1. 今日頁顯示「0 / N 站」、目前站 + **「第 1 趟」徽章**
2. 按 **「開始配送」** → 狀態變 `in_progress`
3. 點 「繼續目前站點」 → CurrentStopPage
4. 按 **「開啟導航」** → 進 **TomTom 多站地圖**：
   - 橘色 pin 標記所有站、目前 active 高亮
   - 真實 polyline + turn-by-turn instruction banner
   - 車道引導（lane guidance）+ 語音播報
   - 左下速度 chip（km/h）、右下多站進度 chip
5. 抵達 → 自動 callback「已抵達」（GPS 50m 內觸發）→ 回 CurrentStopPage
6. 按 **「完成配送」** → 跳下一站
7. 多站重複；切到第 2 趟時清單會顯示「第 2 趟」分隔線

### 步驟 G · 主管 Dashboard 看變化

回主管 dashboard 刷新：
- 完成率隨 driver 進度上升
- area chart 出現上升橘線
- donut chart 變綠
- 物流士排行依完成率排序

進 **「物流士」** → 點任一卡片 → detail 頁看時間軸 + 地圖佔位（idle driver 點進去顯示「今日無任務」，不會 404）

### 步驟 H · AI 分析

回 dashboard，按 **「AI 分析目前配送狀況」**：跳 modal 顯示 summary / 風險等級 / 延誤路線 / 建議行動（mock，介面已包好可換真實 LLM）

### 步驟 I · 路線歷史

側欄點 **「路線歷史」**：
- 多個版本：archived / draft / published
- 展開看 driver 的 stops 列表
- 用搜尋框打「板橋」可以快速濾出含板橋站的版本

---

## 3. KPI 對照表（以 phase1 設定 6 站 / 2 driver 為例）

| Demo 進度 | 完成率 | 配送到店率 | 準時率 | 到店數 |
|---|---|---|---|---|
| 初始 | 0.0% | 0.0% | 0.0% | 0 |
| Driver1 完成第 1 站 | 16.7% | 16.7% | 100.0% | 1 |
| Driver1 完成 3 站 | 50.0% | 50.0% | 100.0% | 3 |
| 兩位都完成 | 100.0% | 100.0% | 100.0% | 6 |

> Dashboard 不會 realtime push（目前實作），按瀏覽器 refresh 看新值。

驗證 SQL：
```sql
select * from v_daily_metrics where delivery_date = current_date;
```

---

## 4. 常見問題排除

### 主管登入後跳回 `/login?error=not-manager`

```sql
update profiles set role = 'manager'
 where id = (select id from auth.users where email = 'manager@example.com');
```

### Driver App 顯示「請重新登入」

Bearer JWT 過期或從未登入。再登入一次即可。
要跳過登入測試 API，可在 `apps/web/.env.local` 加：

```
ALLOW_DEV_DRIVER=true
DEV_DRIVER_EMAIL=driver1@example.com
```

只在 `NODE_ENV != production` 生效；重啟 Next.js 後不帶 Bearer 也能打 `/api/driver/*`。

### Flutter Web `ClientException: Failed to fetch`

1. Next.js 開了嗎？瀏覽器試 `http://localhost:3000/api/driver/today`，應回 `{"success":false,"error":"需要登入"}`
2. 完全重啟 Flutter App（紅色 ■ → F5），hot reload 不會吃 `--dart-define`
3. 看 Chrome DevTools Network tab 的 `today` 請求 Response Headers 有沒有 `Access-Control-Allow-Origin`

### TomTom 地圖一片灰

- 沒設 `TOMTOM_API_KEY`（Web 是 `apps/web/.env.local`、Flutter 是 `.vscode/launch.json`）
- key 額度用完（免費版每日 2500 次）
- key 沒勾選 Routing Matrix / Maps API 權限

### Gurobi 試算彈窗「Gurobi engine 不可用，已 fallback 跑 mock」

點開 diagnostics JSON：
- `error_kind: missing_dependency` → `or-engine/.venv` 沒裝或 gurobipy 沒裝；跑 §1.7
- `error_kind: solver_no_solution` 且 `status=3` → infeasible，多半是司機 / 容量不夠或夜班 stop 沒夜班 driver（看 `total_demand` vs `total_capacity`）
- `resolved_python: "python"`（沒走 venv）→ 把 `or-engine/.venv` 建好就會自動偵測

### OR 跑完只用了一個司機

正常 — MTVRP 目標式有 β（派工成本），β 越大越偏好集中。如果想分散到所有 driver：
- 在「規劃參數」把 β 滑到很低（例如 0 ~ 20）
- 或讓更多 stop / 拉高每站貨量，讓容量壓到必須多人

### Postgres `42P17 infinite recursion`

代表你沒跑 §1.1 的第二支 migration（`20260518000000_fix_rls_recursion.sql`）。補跑即可。

### 主管 Dashboard KPI 全 0 但 SQL 有資料

時區問題。`apps/web/.env.local` 加：
```
APP_TIMEZONE=Asia/Taipei
```

### 想完全重置路線資料 / 從頭來過

跑 [`supabase/seed/nuke_route_plans.sql`](supabase/seed/nuke_route_plans.sql)：

清掉 route_plans + driver_clusters + driver_route_assignments + route_stops + delivery_tasks + or_planning_jobs。**不會動 stops 主檔 / profiles / auth.users**。整支包在 transaction，跑完印 remaining 計數確認。

之後可以從主管 UI 重新跑 OR 試算、發布，重建任務。

---

## 5. 完整流程驗證 SQL

```sql
-- 今日所有 driver 的進度
select p.full_name, p.employee_code, dt.status,
       count(dts.id) filter (where dts.status='completed') || '/' || count(dts.id) as progress
  from delivery_tasks dt
  join profiles p on p.id = dt.driver_id
  left join delivery_task_stops dts on dts.delivery_task_id = dt.id
 where dt.delivery_date = current_date
 group by p.full_name, p.employee_code, dt.status
 order by p.employee_code;

-- 今日 KPI（同 dashboard）
select * from v_daily_metrics where delivery_date = current_date;

-- 路線版本歷史
select rp.version, rp.status, rp.source, rp.published_at, pp.code
  from route_plans rp
  join planning_periods pp on pp.id = rp.planning_period_id
 order by rp.created_at desc;

-- 各路線集（driver_clusters）
select dc.cluster_name, dc.sequence,
       dc.estimated_total_minutes, dc.estimated_total_volume,
       p.full_name as assigned_driver, dc.required_shift, dc.required_temperature
  from driver_clusters dc
  left join profiles p on p.id = dc.assigned_driver_id
 order by dc.route_plan_id, dc.sequence;

-- AI 分析歷史
select scope, status, output_analysis->>'risk_level' as risk, created_at
  from ai_analysis_requests
 order by created_at desc limit 10;

-- OR 試算紀錄
select status, engine_version, created_route_plan_id, notes, created_at
  from or_planning_jobs
 order by created_at desc limit 10;
```

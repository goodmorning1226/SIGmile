# SIGmile · Demo 操作手冊

> 目標：從零到一跑出「主管 + 兩位物流士」端到端流程，含 KPI 圖表、AI 分析、路線重排、發布新版路線、物流士現場配送。
>
> 你需要 **三個分頁 / 視窗**：
>   1. 主管後台（Next.js Web，`http://localhost:3000`）
>   2. 物流士 A 的 App（Flutter Web Chrome 或 Android emulator）
>   3. Supabase Dashboard（建帳號 / 看資料）

---

## 0. 前置條件

- 已有 Supabase 專案（記下 Project URL、anon key、service_role key）
- Node 20+、npm（或 pnpm / yarn）
- Flutter stable
- VS Code（建議）
- 已 clone 本 repo

---

## 1. 一次性初始化

### 1.1 跑 schema + RLS 修補

Supabase Dashboard → SQL Editor，按時間順序貼下面兩支：

1. [`supabase/migrations/20260517000000_init_schema.sql`](supabase/migrations/20260517000000_init_schema.sql)（schema、enums、indexes、初版 RLS、§8.1 基礎 seed）
2. [`supabase/migrations/20260518000000_fix_rls_recursion.sql`](supabase/migrations/20260518000000_fix_rls_recursion.sql)（修 42P17 遞迴）

> 看到 `[seed] 請先在 Supabase Auth 建立 driver1 / driver2 …已跳過 8.2` 是預期行為。

### 1.2 建 demo 帳號

Dashboard → Authentication → Users → **Add user** 建三個（勾「Auto Confirm User」）：

| Email | Password 建議 | 角色 |
|---|---|---|
| `manager@example.com` | `sigmile-demo-2026` | manager |
| `driver1@example.com` | `sigmile-demo-2026` | driver |
| `driver2@example.com` | `sigmile-demo-2026` | driver |

### 1.3 取得三個 UUID

SQL Editor：

```sql
select id, email from auth.users
 where email in ('manager@example.com','driver1@example.com','driver2@example.com')
 order by email;
```

### 1.4 跑 demo seed

打開 [supabase/seed/demo_seed.sql](supabase/seed/demo_seed.sql)，把開頭 `DO $$` block 內：

```sql
manager_id  uuid := '00000000-0000-0000-0000-000000000099';
driver_1_id uuid := '00000000-0000-0000-0000-000000000001';
driver_2_id uuid := '00000000-0000-0000-0000-000000000002';
```

換成 §1.3 查出來的真實 UUID。整檔貼到 SQL Editor → Run。看到：

```
[demo] DONE. plan=..., task1=..., task2=..., or_job=...
```

即成功。整支 idempotent，可重跑。

### 1.5 啟 Next.js 後台

```powershell
cd apps/web
cp .env.local.example .env.local
# 編輯 .env.local，填入 SUPABASE_* 三個 key
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
# 編輯 .vscode/launch.json 填入 SUPABASE_URL / SUPABASE_ANON_KEY
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

### 1.7（選用）放 logo 圖檔

- `apps/web/public/logo.png` — 後台 sidebar / login / favicon
- `apps/driver_app/assets/images/logo.png` — App login / Today AppBar

兩個可以是同一張。沒放也能跑，只是看不到 logo。

---

## 2. Demo flow（建議 10 分鐘）

### 步驟 A · 主管端 Dashboard 起手

1. Manager 登入 → 進 `/dashboard`
2. 應看到：
   - 6 個 KPI cards 數字全為 0（完成率 0%、配送到店率 0%、準時率 0%、已上傳/已到店/準時 全 0）
   - **「每小時完成進度」** area chart — 還是平的
   - **「站點狀態分佈」** donut chart — 全部 6 站都是「待處理」灰色
   - **「物流士進度排行」** — 王小明 0/3、李小華 0/3
3. 解說：「總共 6 站派給兩位物流士，每人 3 站，今天還沒開始」

### 步驟 B · 看物流士列表

1. 側欄點 **「物流士」**
2. 應看到 2 張卡片：王小明（北市 A 線）、李小華（雙北 B 線），各顯示「0/3 · 0%」
3. **示範搜尋**：在搜尋框打「板橋」，會剩下李小華（因為他的路線含板橋站）
4. **示範狀態篩選**：下拉選「配送中」，目前都是「尚未開始」所以列表空白

### 步驟 C · 物流士 A 開始配送

切換到 Driver1 的 App 視窗：

1. Today 頁顯示「0 / 3 站」、目前站「7-ELEVEN 台北車站門市」
2. 按 **「開始配送」** → task 狀態變 `in_progress`，按鈕變成「繼續目前站點」
3. 點「繼續目前站點」（或側 list 點第一站）→ 進 CurrentStopPage
4. 按 **「開啟導航」** → 進 App 內地圖頁（橘色 pin + 我的位置點 + 虛線連線）
5. 在地圖頁按 **「已抵達」** → 自動回 CurrentStopPage
6. 按 **「完成配送」** → 自動跳到下一站
7. 為了讓 demo 進度好看，**對第二、三站重複步驟 4–6**

### 步驟 D · 主管 Dashboard 看變化

回主管後台 dashboard 刷新（或進 dashboard 重新整理）：

- 完成率：50%（driver1 完成 3 站，driver2 還是 0 → 3/6）
- area chart 出現一條向上爬的橘線
- donut chart 中三段變綠（已完成）三段仍灰（待處理）
- 物流士排行：王小明 100%（綠色 bar）、李小華 0%

進 **「物流士」** → 點王小明卡片 → 進 detail 頁：
- 左邊大地圖看 5 顆 pins
- 右邊時間軸三站都「已完成」+ 「準時」
- 右上角顯示「100%」

### 步驟 E · AI 分析

回 dashboard，按 **「AI 分析目前配送狀況」**：
- 跳出 modal：summary 寫今天的真實數字、風險等級、延誤路線（目前因為都準時，會是空清單）、建議行動

### 步驟 F · 發布新版路線

側欄點 **「發布新路線」**：

1. **步驟 1 規劃參數** 區：展開「服務時間」卡，把「平均服務時間」從 10 改 12 → 按儲存
2. 右上點 **「建立新規劃任務」** → 跳 modal 填 4 個欄位（已預填合理預設）→ 建立
3. 任務列表會出現新一筆 `pending`
4. 按 **「試算」** → 變 `completed`，顯示「物流士 2 / 站數 6 / 預估總工時 X 分鐘」
5. 點 **「明細」** → 看到讀取後的「規劃條件」表單視圖 + 「試算結果」每位 driver 的 stops chips
6. 試算結果滿意 → 按 **「採用並發布」** → 確認對話 → 完成

### 步驟 G · 路線歷史

側欄點 **「路線歷史」**：
- 應該看到兩個版本：v1（archived）+ v2（published）
- 展開 v2 看到所有 driver 的 stops 列表
- 用搜尋框打「板橋」可以快速濾出含板橋站的版本

---

## 3. KPI 對照表

| Demo 進度 | 完成率 | 配送到店率 | 準時率 | 到店數 |
|---|---|---|---|---|
| 初始（步驟 A） | 0.0% | 0.0% | 0.0% | 0 |
| Driver1 完成第一站 | 16.7% | 16.7% | 100.0% | 1 |
| Driver1 完成全部 | 50.0% | 50.0% | 100.0% | 3 |
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

正常 — Bearer JWT 過期或從未登入。再登入一次即可。
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

### Postgres `42P17 infinite recursion`

代表你沒跑 §1.1 的第二支 migration（`20260518000000_fix_rls_recursion.sql`）。補跑即可。

### 主管 Dashboard KPI 全 0 但 SQL 有資料

時區問題。`apps/web/.env.local` 加：
```
APP_TIMEZONE=Asia/Taipei
```

### 重跑 demo seed 卻沒刷新

demo seed 預設 idempotent，不會覆寫已存在的 plan / tasks。要從 0 開始：

```sql
-- ⚠️ 開發專用
delete from delivery_task_stops
 where delivery_task_id in (
   select id from delivery_tasks where delivery_date = current_date
 );
delete from delivery_tasks where delivery_date = current_date;
-- 然後重跑 demo_seed.sql
```

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

-- AI 分析歷史
select scope, status, output_analysis->>'risk_level' as risk, created_at
  from ai_analysis_requests
 order by created_at desc limit 10;

-- OR 試算紀錄
select status, engine_version, created_route_plan_id, created_at
  from or_planning_jobs
 order by created_at desc limit 10;
```

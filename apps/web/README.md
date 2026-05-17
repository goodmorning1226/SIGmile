# SIGmile · Manager Console

Next.js 15 (App Router) + TypeScript + Tailwind + Supabase。
負責「主管端後台」與整個系統的 backend API（driver app 也打這支）。

---

## 啟動

```powershell
# 1. 安裝依賴
npm install

# 2. 環境變數
cp .env.local.example .env.local
# 編輯 .env.local，填入 NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY

# 3. dev server（已綁 0.0.0.0 讓 emulator / Flutter Web 連得到）
npm run dev
```

啟動訊息應該看到：

```
- Local:   http://localhost:3000
- Network: http://10.x.x.x:3000
```

兩行都出現才代表 `-H 0.0.0.0` 生效。

---

## 連 Supabase 的步驟

1. 到 Supabase Dashboard 取得：
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY`（**絕對不可外洩**）
2. 把 [`supabase/migrations/*.sql`](../../supabase/migrations) 按時間順序貼到 SQL Editor 各跑一次（包含 schema + RLS 修補）
3. 至少建立一個 `manager` 角色的 auth user：
   - Dashboard → Authentication → Users → Add user → `manager@example.com`
   - SQL Editor 把 manager 的 profile.role 設好：
     ```sql
     insert into profiles (id, role, full_name, employee_code, distribution_center_id)
     values ('<manager-uuid>', 'manager', '陳主管', 'M-0001',
             '11111111-aaaa-1111-aaaa-111111111111')
     on conflict (id) do update set role = 'manager';
     ```
4. 啟動 `npm run dev` → 進 `http://localhost:3000` → 用 manager 帳號登入

完整 demo 資料（含 driver、route_plan、tasks、AI predictions、OR job）見 [DEMO.md](../../DEMO.md)。

---

## Logo 圖檔

把 logo 放到 `apps/web/public/logo.png` 即可（被 sidebar、login、瀏覽器 favicon 同時引用）。

---

## 認證設計

| 來源 | 認證方式 | helper |
|---|---|---|
| Manager 後台（瀏覽器 same-origin） | Cookie session via `@supabase/ssr` | [`requireManager()`](src/lib/auth/server-auth.ts) |
| Driver App（mobile/Web 跨來源） | Bearer JWT (`Authorization: Bearer ...`) | [`requireDriver(request)`](src/lib/auth/bearer-auth.ts) |

### Dev fallback（demo 用，正式環境自動關閉）

在 `.env.local` 加：

```
ALLOW_DEV_DRIVER=true
DEV_DRIVER_EMAIL=driver1@example.com
```

之後**不帶 Bearer** 也能打 `/api/driver/*`，後端自動扮演那位 driver。
條件：`NODE_ENV !== 'production'`，正式 build 會直接忽略此 env。

---

## CORS

`/api/*` 在 [middleware.ts](middleware.ts) 一律加 `Access-Control-Allow-Origin` 等 headers，
並對 `OPTIONS` preflight 直接回 204。Flutter Web / 跨網域工具都能直接呼叫。

---

## Mock 整合接口（未來換真實服務只動這幾檔）

| 服務 | 檔案 | 替換方式 |
|---|---|---|
| Google Maps 導航 | [src/lib/services/google-navigation-service.ts](src/lib/services/google-navigation-service.ts) | 新增 `RealGoogleNavigationService implements IGoogleNavigationService`，呼叫 Google Routes API |
| OR 規劃 | [src/lib/services/or-planning-service.ts](src/lib/services/or-planning-service.ts) | `runMockPlanningJob` 換成 OR-Tools / 自家 solver，輸出仍寫回 `or_planning_jobs.output_plan` JSONB |
| AI 分析 / 預測 / 急件建議 | [src/lib/services/ai-service.ts](src/lib/services/ai-service.ts) | 換成 `RealAIService` 呼叫 Anthropic / OpenAI |
| KPI 即時計算 | [src/lib/services/metrics-service.ts](src/lib/services/metrics-service.ts) | 流量大時改 read `delivery_metrics_snapshots` 快照表 |

---

## 已實作頁面

| 路由 | 功能 |
|---|---|
| `/login` | Manager 登入 + role 檢查 |
| `/dashboard` | 6 KPI cards + 3 圖表（每小時完成 area / 站點狀態 donut / 物流士排行 bar）+ AI 分析按鈕 + 快速操作 |
| `/drivers` | 物流士今日進度 grid + 搜尋 + 狀態篩選 |
| `/drivers/[id]` | 地圖佔位（大）+ 停靠點時間軸 + 上下排序 |
| `/or-replanning` | 「發布新路線」整合頁：規劃參數編輯 + 試算任務 + 採用並發布 |
| `/route-planning` | 「路線歷史」：依期間 / 狀態 / 物流士搜尋的版本檢視 |
| `/ai-analysis` | 所有 AI 分析結果歷史 + 產生新分析 |

---

## API 路由速覽

```
/api/manager/dashboard                    GET    KPI snapshot
/api/manager/drivers/[id]/reorder         PATCH  手動調 task_stops 順序
/api/manager/route-plans/[id]/publish     POST   發布 route plan
/api/manager/or-jobs                      GET POST
/api/manager/or-jobs/[id]/mock-run        POST   試算
/api/manager/or-jobs/[id]/materialize     POST   採用 → 建立 draft
/api/manager/or-jobs/[id]/materialize-and-publish  POST   採用並發布
/api/manager/parameters                   POST
/api/manager/parameters/[id]              PATCH
/api/manager/ai-analysis                  GET POST

/api/driver/today                         GET
/api/driver/tasks/[taskId]/start          POST
/api/driver/task-stops/[id]/navigate      POST
/api/driver/task-stops/[id]/arrive        POST
/api/driver/task-stops/[id]/complete      POST
/api/driver/task-stops/[id]/exception     POST
/api/driver/location                      POST
```

---

## 資料夾結構

```
apps/web/src/
├── app/
│   ├── login/                             登入頁
│   ├── (manager)/                         role guard layout + 所有主管端頁面
│   │   ├── dashboard/                     今日總覽（含圖表）
│   │   ├── drivers/                       物流士列表 + detail
│   │   ├── or-replanning/                 發布新路線（整合 parameters + 試算）
│   │   ├── route-planning/                路線歷史
│   │   └── ai-analysis/                   AI 分析歷史
│   └── api/
│       ├── manager/                       Cookie session 認證
│       └── driver/                        Bearer JWT 認證
├── components/
│   ├── ui/                                button / card / input / table / ...
│   ├── form/                              Field / NumberInput / SelectInput / TagsInput
│   ├── charts/                            HourlyProgress / DriverRanking / StatusDonut
│   ├── layout/                            Sidebar / PageHeader / ComingSoon
│   ├── kpi/                               KpiCard
│   ├── map/                               MapPlaceholder
│   └── status/                            StatusBadge
├── lib/
│   ├── supabase/                          client / server / admin
│   ├── services/                          ★ 集中所有 business logic + mock 服務
│   ├── auth/                              server-auth (cookie) + bearer-auth (JWT)
│   └── api/                               response helpers
└── types/                                 domain enums + DTO
```

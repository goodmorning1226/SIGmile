# SIGmile

物流配送管理系統 · MVP

橘色主、綠色次的配色，主管端 Next.js Web 後台 + 物流士端 Flutter App + Supabase Postgres + RLS + Bearer JWT。
AI / OR / Google Maps 目前都是 mock，介面已包好，未來替換成真實服務時 schema 與呼叫端不用改。

---

## 倉庫結構

```
SIGmile/
├── apps/
│   ├── web/                 # Next.js 15 主管端後台 + 整個系統的 backend API
│   └── driver_app/          # Flutter 物流士端 App（支援 Web / Android emulator / 真機）
├── supabase/
│   ├── migrations/          # PG schema + RLS + Indexes + Trigger
│   └── seed/                # demo 用 seed data
├── .vscode/
│   └── launch.json.example  # 把這檔 copy 成 launch.json 並填入自己的 keys
├── DEMO.md                  # 端到端 demo 操作手冊
└── README.md
```

---

## 從 clone 到跑起來（5 分鐘）

### 1) Supabase 專案

到 https://supabase.com 開一個新專案，記下三個值：
- Project URL
- `anon` public key
- `service_role` secret key

把 [`supabase/migrations/20260517000000_init_schema.sql`](supabase/migrations/20260517000000_init_schema.sql) 與
[`supabase/migrations/20260518000000_fix_rls_recursion.sql`](supabase/migrations/20260518000000_fix_rls_recursion.sql)
按順序貼到 SQL Editor 各跑一次。

### 2) Next.js Web 後台

```powershell
cd apps/web
cp .env.local.example .env.local
# 編輯 .env.local，填入 NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY
npm install
npm run dev
```

啟動訊息看到：

```
- Local:   http://localhost:3000
- Network: http://10.x.x.x:3000
```

兩行都出現代表 `-H 0.0.0.0` 生效（之後 Android 模擬器 / Flutter Web 才能連到）。

### 3) Flutter 物流士 App

```powershell
cp .vscode/launch.json.example .vscode/launch.json
# 編輯 .vscode/launch.json，把 SUPABASE_URL / SUPABASE_ANON_KEY 填上
```

接著在 VS Code Run and Debug 面板選一個 config：

| Config | 適用情境 | API_BASE_URL |
|---|---|---|
| **driver_app (Web · Chrome)** | 最方便，跑 Chrome | `http://localhost:3000` |
| **driver_app (Android emulator)** | Android 模擬器 | `http://10.0.2.2:3000` |
| **driver_app (physical device / WiFi)** | 真機，需手機跟 PC 同 WiFi | 換成 PC 區網 IP，例如 `http://192.168.1.20:3000` |

按 F5 啟動。Android emulator 路徑首次需要先：

```powershell
cd apps/driver_app
flutter create . --platforms=android --project-name=sigmile_driver
# 編輯 android/app/src/main/AndroidManifest.xml 的 <application> 加 android:usesCleartextTraffic="true"
```

### 4) 建 demo 帳號 + seed 資料

照 [DEMO.md](DEMO.md) §1 步驟，建立 `manager@example.com` / `driver1@example.com` / `driver2@example.com`，並執行 [`supabase/seed/demo_seed.sql`](supabase/seed/demo_seed.sql)（記得先替換 UUID）。

---

## Logo 圖檔擺放位置

`apps/web/public/logo.png`（後台 sidebar、login、favicon 用）
`apps/driver_app/assets/images/logo.png`（Flutter login 大圖、Today AppBar 小 logo）

兩個檔可以是同一張。沒放也能跑，只是看不到 logo。

---

## 主要技術

| 層 | 技術 |
|---|---|
| 後台 + API | Next.js 15 (App Router) + TypeScript + Tailwind |
| 物流士 App | Flutter 3.22+ · Riverpod 2 · go_router 14 |
| 資料庫 | Supabase Postgres + Row Level Security |
| 認證 | Supabase Auth · Bearer JWT（mobile/Web）/ Session cookie（manager 後台） |
| Mock 服務 | AI 分析、AI 參數預測、OR 路線規劃、Google Maps 導航（全可 swap） |

---

## 已實作功能

**主管端**
- 今日總覽：KPI + 圖表（每小時完成進度 / 站點狀態 donut / 物流士排行）+ AI 分析按鈕
- 物流士列表：搜尋（姓名 / 員編 / 路線 / 門市）+ 狀態篩選
- 物流士 detail：地圖佔位（大）+ 停靠點時間軸 + 上下排序
- 發布新路線：規劃參數編輯 + 試算 + 一鍵採用並發布
- 路線歷史：依期間 / 狀態 / 物流士搜尋的版本檢視器
- AI 分析歷史：所有分析結果條列檢視

**物流士端**
- 登入（角色檢查：非 driver 拒絕）
- 今日任務：問候 + 進度卡 + 目前 / 下一站
- 停靠點清單
- 目前站點：開啟導航 / 已抵達 / 完成配送 / 回報異常
- App 內導航地圖（佔位，未串 Google Maps）
- 異常回報：6 種原因 + 備註

**整合保留接點**
- [apps/web/src/lib/services/ai-service.ts](apps/web/src/lib/services/ai-service.ts) — 換真實 AI 模型只動這檔
- [apps/web/src/lib/services/or-planning-service.ts](apps/web/src/lib/services/or-planning-service.ts) — 換真實 OR engine 只動這檔
- [apps/driver_app/lib/services/navigation_service.dart](apps/driver_app/lib/services/navigation_service.dart) + [widgets/map_placeholder.dart](apps/driver_app/lib/widgets/map_placeholder.dart) — 換 Google Maps SDK 只動這兩檔

---

## 文件索引

- **[DEMO.md](DEMO.md)** — 端到端 demo 流程 + KPI 對照表 + 故障排除
- **[apps/web/README.md](apps/web/README.md)** — 主管後台細節
- **[apps/driver_app/README.md](apps/driver_app/README.md)** — 物流士 App 細節

---

## 安全提醒

- `.env.local` 與 `.vscode/launch.json` 都已被 .gitignore 排除，**含 Supabase keys 的檔案不會進 repo**
- `supabase/migrations/` 用 RLS 限制 driver 只能讀寫自己的 task；manager 可全讀
- 後端有可選的 `ALLOW_DEV_DRIVER` 開發 fallback（只在 `NODE_ENV != production` 生效），詳見 [apps/web/.env.local.example](apps/web/.env.local.example)

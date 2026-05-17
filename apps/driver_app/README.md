# SIGmile · Driver App

Flutter 物流士端 App。支援 **Web (Chrome)**、**Android emulator / 真機**、**iOS Simulator**。
Google Maps 目前不串接，App 內以 placeholder 地圖呈現。

---

## 啟動方式（推薦：VS Code Debug 面板）

### 0) 複製 launch.json 樣板並填入自己的 keys

```powershell
# 在 repo 根目錄
cp .vscode/launch.json.example .vscode/launch.json
# 編輯 .vscode/launch.json，把 SUPABASE_URL / SUPABASE_ANON_KEY 填上
```

`.vscode/launch.json` 已被 `.gitignore` 排除，不會 commit 出去。

### 1) 安裝 Flutter 依賴

```powershell
cd apps/driver_app
flutter pub get
```

### 2) Run and Debug 選一個 config（F5）

| Config 名稱 | 適用情境 | API_BASE_URL |
|---|---|---|
| **driver_app (Web · Chrome)** | 最方便、不用裝 Android | `http://localhost:3000` |
| **driver_app (Android emulator)** | Android 模擬器 | `http://10.0.2.2:3000` |
| **driver_app (physical device / WiFi)** | 真機 + 同 WiFi | `http://<PC IP>:3000` |

[lib/config/api_config.dart](lib/config/api_config.dart) 會根據執行平台自動挑 base URL；
即使 launch config 傳錯的 URL（例如 `10.0.2.2` 在 Web 環境），會自動 fallback 到 `localhost`。

### 3)（僅 Android 需要）首次初始化

```powershell
flutter create . --platforms=android --project-name=sigmile_driver
```

然後編輯 `android/app/src/main/AndroidManifest.xml`，在 `<application>` 加：

```xml
android:usesCleartextTraffic="true"
```

否則 Android 9+ 連純 HTTP 的 dev server 會被擋。

---

## Logo 圖檔

存到 `apps/driver_app/assets/images/logo.png` 即可（已在 [`pubspec.yaml`](pubspec.yaml) 註冊）。
被 Login 頁大圖 + Today AppBar 小 logo 同時引用。

---

## 認證流程

1. App 啟動 → router 檢查 `supabase.auth.currentSession`
2. 無 session → 跳 `/login`
3. Login 用 email/password 透過 `supabase_flutter` 登入，session 寫 localStorage（Web）或安全儲存（mobile）
4. 跳 `/today`，後續 API 自動帶 `Authorization: Bearer <jwt>`
5. 若 API 回 401（token 失效）→ `ApiErrorView` 顯示「請重新登入」+ 自動跳回 /login

詳細：[`lib/services/api_client.dart`](lib/services/api_client.dart)、[`lib/widgets/api_error_view.dart`](lib/widgets/api_error_view.dart)

---

## 主要頁面

| Route | 功能 |
|---|---|
| `/login` | email/password 登入，role 必須為 driver |
| `/today` | 今日任務：問候、進度卡、目前 / 下一站、CTA 按鈕 |
| `/stops` | 停靠點清單（依 stop_order） |
| `/stops/:id` | 當前站點：4 顆主操作按鈕（導航 / 抵達 / 完成 / 異常） |
| `/stops/:id/navigate` | App 內地圖導航頁（**未來會接 Google Maps**） |
| `/stops/:id/exception` | 異常回報：6 種原因 chips + 備註 |
| `/profile` | 個人資料 + 登出 |

---

## 未來接 Google Maps Navigation SDK

**只動兩個檔案**：

1. [lib/widgets/map_placeholder.dart](lib/widgets/map_placeholder.dart) — 整個 widget 換成 `GoogleMap(...)`
2. [lib/services/navigation_service.dart](lib/services/navigation_service.dart) — 加 `RealGoogleNavigationService implements NavigationService`，
   實作 `estimateTravelTime` / `prepareRoute`；
   接著在 [lib/providers/service_providers.dart](lib/providers/service_providers.dart) 把
   `MockNavigationService()` 換掉

NavigationMapPage / CurrentStopPage / router **不用改任何一行**。

---

## 資料夾結構

```
lib/
├── main.dart                       入口（印 env、init Supabase、init locale、runApp）
├── config/
│   ├── env.dart                    讀 --dart-define
│   └── api_config.dart             ★ 依平台挑 base URL（Web/Android/真機）
├── core/supabase_init.dart
├── app/
│   ├── app.dart                    MaterialApp.router
│   ├── router.dart                 go_router + auth redirect
│   └── theme.dart                  橘+綠主題、大字大鈕
├── models/                         Profile / Stop / DeliveryTask / DeliveryTaskStop
├── services/
│   ├── api_client.dart             Bearer 注入 + 智慧錯誤訊息
│   ├── auth_service.dart           supabase signIn / signOut / fetchMyProfile
│   ├── driver_task_service.dart    呼叫 /api/driver/*
│   ├── driver_location_service.dart
│   └── navigation_service.dart     ★ 未來接 Google Maps 的點
├── providers/                      Riverpod providers
├── widgets/
│   ├── api_error_view.dart         401 → 顯示「請重新登入」+ 跳 /login
│   ├── map_placeholder.dart        ★ 未來換成 GoogleMap 的點
│   ├── primary_action_button.dart
│   ├── stop_status_chip.dart
│   └── ...
└── pages/                          login / today / stop_list / current_stop / navigation_map / exception / profile
```

---

## 常見問題

### `ClientException: Failed to fetch`

Flutter Web 跨來源時瀏覽器擋下。檢查：
1. Next.js dev server 跑了沒？`http://localhost:3000/api/driver/today` 應回 `{"success":false,"error":"需要登入"}`
2. CORS middleware 還在嗎？看 [apps/web/middleware.ts](../../apps/web/middleware.ts)
3. 完全重啟 Flutter（紅色 ■ → F5）；hot reload 不會吃 `--dart-define`

### `TimeoutException after 0:00:30`

Next.js dev 第一次編譯 route 慢，再試一次就好。

### App 一直跳「請重新登入」

Supabase session 過期或從未登入。回 /login 重新登入即可。
要在無登入下測 API，可在 `apps/web/.env.local` 設：

```
ALLOW_DEV_DRIVER=true
DEV_DRIVER_EMAIL=driver1@example.com
```

只在 `NODE_ENV != production` 生效。

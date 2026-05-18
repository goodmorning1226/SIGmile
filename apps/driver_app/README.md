# SIGmile · Driver App

Flutter 物流士端 App。支援 **Web (Chrome)**、**Android emulator / 真機**、**iOS Simulator**。
App 內導航走 **TomTom Maps + Routing API**（純 REST，全平台共用一份程式碼）；
要 turn-by-turn 語音時提供「跳外部 Google Maps」備援。

---

## 啟動方式（推薦：VS Code Debug 面板）

### 0) 複製 launch.json 樣板並填入自己的 keys

```powershell
cp .vscode/launch.json.example .vscode/launch.json
# 編輯 .vscode/launch.json，把 SUPABASE_URL / SUPABASE_ANON_KEY / TOMTOM_API_KEY 填上
```

`.vscode/launch.json` 已被 `.gitignore` 排除。

### 1) 安裝 Flutter 依賴

```powershell
cd apps/driver_app
flutter pub get
```

### 2) Run and Debug 選一個 config（F5）

| Config 名稱 | 適用情境 | API_BASE_URL | TomTom 地圖 |
|---|---|---|---|
| **driver_app (Web · Chrome)** | 最方便、不用裝 Android | `http://localhost:3000` | ✅ |
| **driver_app (Android emulator)** | Android 模擬器 | `http://10.0.2.2:3000` | ✅ |
| **driver_app (physical device / WiFi)** | 真機 + 同 WiFi | `http://<PC IP>:3000` | ✅ |

[lib/config/api_config.dart](lib/config/api_config.dart) 會依平台自動挑 base URL。

### 3)（僅首次 Android）初始化平台目錄

```powershell
flutter create . --platforms=android --project-name=sigmile_driver
```

編輯 `android/app/src/main/AndroidManifest.xml` 在 `<application>` 加：

```xml
android:usesCleartextTraffic="true"
```

Android 9+ 連純 HTTP dev server 才不會被擋。

---

## ★ TomTom Maps + Routing API 啟用

### 1) 申請 API key（5 分鐘）

1. 開 https://developer.tomtom.com/ 註冊（**免信用卡**）
2. Dashboard → **My Credentials** → **+ Add a new key**
3. App name 隨便填（例 `sigmile-driver`），Allowed origins 留空（dev 階段）
4. 拿到的 key 長相：`xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

### 2) 把 key 填到 launch.json

```json
"--dart-define=TOMTOM_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

F5 重啟即生效（hot reload 不會吃 dart-define）。

### 3) 免費額度

- **每日 50,000 個 tile 請求**（地圖瓦片）
- **每日 2,500 個 non-tile 請求**（包含 Routing API）
- 黑客松 demo 用量根本用不完；50 站 demo × 多次測 = ~500 calls/day
- **不需要信用卡 + 不需要 contact sales**

### 4) 驗證

開 `/today` → 點任一站 → 「開啟導航（App 內）」
- 看到 TomTom 地圖瓦片載入 + 橘色路線 polyline + 司機 GPS 藍點 + 目的地橘色 pin → ✅
- 看到黃色「尚未設定 TomTom API Key」→ 檢查 launch.json 是否填了 key + F5 重啟
- 看到直線虛線（不是真實路線）→ Routing API call 失敗，看 console log `[tomtom]` 標籤

### 5) 抵達自動偵測

App 訂閱 GPS stream，距離目的地 **≤ 50m 自動觸發 `markArrived(stopId)`**。
不用 driver 手動按按鈕（按鈕也保留當備援）。

---

## ★ 備援：跳外部 Google Maps（語音導航）

TomTom 只提供路線資料，**沒有 turn-by-turn 語音**。司機真要邊開車邊導航時，
按「**用 Google Maps 開啟（含語音）**」即可跳系統 Google Maps app，
完整 turn-by-turn 語音 + 車道指引 + 重新規劃（**完全免費**）。

Android：`google.navigation:q=lat,lng&mode=d` intent
iOS：    `comgooglemaps://?daddr=lat,lng` URL scheme
Web：    `https://www.google.com/maps/dir/?api=1&destination=lat,lng` universal link

物流業實際做法：App 管任務狀態，駕駛交給專門的 navigation app。

---

## Logo 圖檔

存到 `apps/driver_app/assets/images/logo.png`。

---

## 認證流程

1. App 啟動 → router 檢查 `supabase.auth.currentSession`
2. 無 session → 跳 `/login`
3. Login 用 email/password 透過 `supabase_flutter` 登入
4. 跳 `/today`，後續 API 自動帶 `Authorization: Bearer <jwt>`
5. 若 API 回 401 → `ApiErrorView` 顯示「請重新登入」+ 跳回 /login

詳細：[`lib/services/api_client.dart`](lib/services/api_client.dart)

---

## 主要頁面

| Route | 功能 |
|---|---|
| `/login` | email/password 登入，role 必須為 driver |
| `/today` | 今日任務：問候、進度卡、目前 / 下一站 |
| `/stops` | 停靠點清單 |
| `/stops/:id` | 當前站點：4+1 顆操作按鈕（App 內導航 / 外部 Google Maps / 抵達 / 完成 / 異常） |
| `/stops/:id/navigate` | **TomTom 地圖 + 路線 + GPS 跟車 + 抵達自動觸發** |
| `/stops/:id/exception` | 異常回報 |
| `/profile` | 個人資料 + 登出 |

---

## 資料夾結構

```
lib/
├── main.dart
├── config/
│   ├── env.dart                    讀 --dart-define（含 TOMTOM_API_KEY）
│   └── api_config.dart
├── core/supabase_init.dart
├── app/                            MaterialApp.router / theme
├── models/                         Profile / Stop / DeliveryTask / DeliveryTaskStop
├── services/
│   ├── api_client.dart
│   ├── auth_service.dart
│   ├── driver_task_service.dart
│   ├── driver_location_service.dart
│   ├── tomtom_routes_service.dart        ★ 呼叫 TomTom Routing API + polyline 解析
│   └── external_navigation_launcher.dart ★ 跳外部 Google Maps app
├── providers/                      Riverpod providers
├── widgets/
│   ├── api_error_view.dart
│   ├── tomtom_map_view.dart        ★ flutter_map + TomTom tile + polyline + GPS 藍點
│   └── ...
└── pages/                          login / today / stop_list / current_stop / navigation_map / exception / profile
```

---

## 常見問題

### 地圖一片空白

1. 檢查 console log：應該看到 `[tomtom]` 開頭的訊息
2. 確認 `TOMTOM_API_KEY` 有填且 F5 重啟過
3. 確認網路通：emulator/瀏覽器能開 https://api.tomtom.com

### 司機藍點不動 / 一直在 Mountain View

- **Web**：瀏覽器要 HTTPS 才能拿 GPS（dev 階段 localhost 例外）；同意瀏覽器的位置權限
- **Android emulator**：Extended Controls → Location → Send 一個坐標
  推薦台北：`25.0610, 121.4847`
- **真機**：戶外或窗邊，第一次 GPS lock 需要 ~30 秒

### `[tomtom] HTTP 403`

API key restrictions 太嚴。dev 階段先到 [TomTom Dashboard](https://developer.tomtom.com/user/me/apps)
把 Allowed origins / Application restrictions 清空。

### `[tomtom] HTTP 429`

超過 2500 calls/day 免費額度，或一秒內請求太多。等隔天重置。

### `ClientException: Failed to fetch`（後端連不上）

1. Next.js dev server 跑了沒？`http://localhost:3000/api/driver/today` 應回 `{"success":false,"error":"需要登入"}`
2. CORS middleware 還在嗎？看 [apps/web/middleware.ts](../../apps/web/middleware.ts)
3. 完全重啟 Flutter（紅色 ■ → F5）；hot reload 不會吃 `--dart-define`

### App 一直跳「請重新登入」

Supabase session 過期。回 /login 重新登入。
要在無登入下測 API，可在 `apps/web/.env.local` 設：

```
ALLOW_DEV_DRIVER=true
DEV_DRIVER_EMAIL=driver1@example.com
```

只在 `NODE_ENV != production` 生效。

# or-engine 設定指南（macOS）

給 Mac 上的協作者用：clone repo 後，照這份從頭跑一次，確保 Gurobi 真的有跑、
**不會 fallback 到 mock**。所有指令都在 repo root 執行（除非另註明）。

---

## 0. 前置條件

- macOS 12 (Monterey) 以上
- Repo 已 clone 在本機
- 已裝好 [Homebrew](https://brew.sh/)
- Next.js dev server 已能跑（`apps/web/.env.local` 已設好 Supabase / TomTom keys）

驗證：
```bash
brew --version    # 任意版本都 OK
git --version
```

---

## 1. 裝 Python 3.11 (或 3.10 / 3.12)

`gurobipy ≥ 11` 支援 Python 3.9–3.12。建議用 **3.11**：

```bash
brew install python@3.11
which python3.11    # 應輸出 /opt/homebrew/bin/python3.11 (Apple Silicon)
                    # 或 /usr/local/bin/python3.11        (Intel Mac)
```

---

## 2. 建 venv 並裝 gurobipy

```bash
cd or-engine
python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt    # 裝 gurobipy>=11.0
```

確認裝好：
```bash
.venv/bin/python -c "import gurobipy; print(gurobipy.__version__)"
# 預期輸出：11.x.x 或 12.x.x
```

⚠️ **不要**用 conda / pyenv 裝在系統其他地方 — Next.js 會自動偵測
`or-engine/.venv/bin/python`，路徑放對就完全免設定。如果你已經有自己的 conda env
要用，可以走第 7 步的進階設定。

---

## 3. 設定 Gurobi License

`gurobipy` 已裝好，但**沒 license 就會在 model.optimize() 失敗**，
而且失敗訊息會讓 Next.js fallback 到 mock。三種 license 任一種都可：

### 3a. 學術 license（最常見）

1. 申請：https://www.gurobi.com/downloads/end-user-license-agreement-academic/
2. 拿到 `grbgetkey <UUID>` 指令後在終端機跑：
   ```bash
   .venv/bin/grbgetkey <你的-UUID>
   ```
3. 預設會把 `gurobi.lic` 存到 `~/gurobi.lic`，gurobipy 自動會找到。
4. 驗證：
   ```bash
   .venv/bin/python -c "import gurobipy as gp; gp.Model().optimize()"
   # 應該印出 "Set parameter LicenseID..." 然後正常結束（空 model）
   # 若印出 "No Gurobi license found" → license 沒裝好
   ```

### 3b. WLS / Named-User Web license

公司 / 商業環境通常給 WLS license。下載 `gurobi.lic` 後：
```bash
mkdir -p ~/
mv ~/Downloads/gurobi.lic ~/gurobi.lic
# 或設環境變數
export GRB_LICENSE_FILE=~/gurobi.lic
```
驗證同 3a。

### 3c. Container / 沒 license 的情況

**不允許**。沒 license → optimize() throw → Next.js fallback to mock。
請務必裝好 license 再進下一步。

---

## 4. 從 Next.js 端驗證能找到 Python

回 repo root，把 dev server **重啟**一次（這很重要，Next.js 會在 spawn 時即時偵測）：
```bash
cd apps/web
pnpm dev      # 或 npm run dev / yarn dev
```

然後：
1. 登入主管帳號
2. 進「發布新路線」頁
3. 步驟 2 直接按「建立試算任務」（用預設參數）
4. 開瀏覽器 DevTools → Network，看 `/api/manager/or-jobs` 的 response

在新任務的卡片內展開 `diagnostics`：
- `resolved_python` 應該是 `…/or-engine/.venv/bin/python`
- `resolved_engine_root` 應該是 `…/or-engine`
- `venv_detected: true`
- `engine_version` 是 `gurobi` 而**不是** `mock-fallback`

成功的話卡片狀態會變 `completed`，objective、gap、runtime 都有值。

---

## 5. 怎麼確認沒 fallback 到 mock？

兩個地方都看：

**A. 卡片標題列**

OR 試算成功的卡片右上會顯示 `gurobi-v?.?.?`；mock fallback 會顯示 `mock-fallback`。
也會有黃色提示 banner 寫「Gurobi engine 不可用，已 fallback 跑 mock」+ 失敗原因。

**B. or-engine 子程序 log**

在 Next.js dev server 的 terminal 直接看 stdout / stderr：
- 真的 spawn 成功會看到 `[or-engine] subprocess pid=...`
- gurobipy import 失敗會看到 `error_kind=missing_dependency`
- license 失敗會看到 `gurobipy.GurobiError: license expired ...`

修法：
| 看到什麼 | 怎麼修 |
|---|---|
| `subprocess_error: spawn EACCES` | `chmod +x or-engine/.venv/bin/python` |
| `subprocess_error: spawn ENOENT` | venv 沒建好，或在錯的目錄 — 重做第 2 步 |
| `error_kind=missing_dependency` | venv 裡沒 gurobipy — `source .venv/bin/activate && pip install -r requirements.txt` |
| `GurobiError: No Gurobi license` | License 沒裝 — 做第 3 步 |
| `日班需求 460 > 日班容量 360` | 跑 `supabase/seed/patch_driver_capacity_to_250.sql` 把 driver capacity 補到 250 |

---

## 6. （可選）跑一次純 Python smoke test

不靠 Next.js，直接餵 sample input 給 solver：
```bash
cd or-engine
.venv/bin/python -c "
import json, subprocess
demo = {
  'depot': {'id': 'd', 'lat': 24.95, 'lng': 121.22},
  'stops': [
    {'id': 's1', 'lat': 24.96, 'lng': 121.23, 'demand': 10, 'service_minutes': 5, 'shift': 1},
    {'id': 's2', 'lat': 24.94, 'lng': 121.21, 'demand': 8,  'service_minutes': 5, 'shift': 1}
  ],
  'drivers': [
    {'id': 'p1', 'shift': 1, 'capacity': 250, 'max_minutes': 720, 'overtime_threshold': 480}
  ],
  'tau': [[0, 3, 4], [3, 0, 5], [4, 5, 0]],
  'weights': {'alpha': 1.0, 'beta': 300.0, 'gamma': 1.5},
  'num_trips': 1,
  'time_limit_sec': 10,
  'mip_gap': 0.05
}
r = subprocess.run(['.venv/bin/python', 'solver_main.py'],
                   input=json.dumps(demo), capture_output=True, text=True, timeout=60)
print('STDOUT:', r.stdout)
print('STDERR:', r.stderr)
"
```

預期 stdout 是 `{"ok": true, "status": 2, "objective": ..., ...}`。
如果 `ok: false`，看 stderr / error_kind 對照第 5 步表格修。

---

## 7. （可選）進階：用其他 Python（非 `.venv`）

如果你堅持要用 conda / pyenv，在 [`apps/web/.env.local`](../apps/web/.env.local) 加：

```bash
# 顯式指定 Python 執行檔
OR_ENGINE_PYTHON=/Users/you/miniconda3/envs/gurobi/bin/python

# 可選：solve timeout（秒）— 超過會 fallback
OR_ENGINE_TIMEOUT_SEC=120
```

Python 解析順序（前面找不到才往後試）：
1. `OR_ENGINE_PYTHON` 環境變數
2. `or-engine/.venv/bin/python`（自動偵測）← 推薦路徑
3. `or-engine/venv/bin/python`（自動偵測）
4. 系統 `python3`

改完 .env.local 要**重啟 dev server** 才會生效。

---

## 8. 常見問題 (FAQ)

**Q: 為什麼一定要在 `or-engine/.venv` 不能在 repo root？**
A: Next.js 在 `or-engine/` 子目錄找 `.venv/bin/python`，因為 spawn 的 cwd 是
`or-engine/`。放別處需要設 `OR_ENGINE_PYTHON`。

**Q: Apple Silicon (M1/M2/M3) 有特別要注意嗎？**
A: gurobipy 11+ 已原生支援 arm64。確保用 `python3.11` 而不是 Rosetta 模擬的
x86 python。可以用 `file .venv/bin/python` 看 — 應該是 `Mach-O 64-bit executable arm64`。

**Q: `gurobi.lic` 已存在但還是說沒 license？**
A: 看 `~/.gurobi/gurobi.lic` 或 `/opt/gurobi*/gurobi.lic` — gurobipy 找的順序：
1. `GRB_LICENSE_FILE` 環境變數指定的路徑
2. `~/gurobi.lic`
3. `/opt/gurobi/gurobi.lic`

設明確路徑最保險：
```bash
echo 'export GRB_LICENSE_FILE=$HOME/gurobi.lic' >> ~/.zshrc
source ~/.zshrc
```

**Q: dev server log 看到 spawn 但 solver 直接卡住？**
A: 試算大小不對。Mac 上 default `time_limit_sec=120` 可能不夠；
在 `.env.local` 加 `OR_ENGINE_TIMEOUT_SEC=300` 給 5 分鐘。

**Q: `.venv` 已經建好但 npm 跑時還是 fallback？**
A: 99% 是 dev server 沒重啟。`Ctrl+C` 殺掉再 `pnpm dev`。Next.js 的 module
是 process-cached 的，env 變動不會 hot-reload。

---

## 9. 一次性 commit 前檢查

執行第 4 步驗證 OK 後，跑一次：
```bash
.venv/bin/python -c "import gurobipy; print('gurobi', gurobipy.__version__, 'OK')"
```

只要不是 `mock-fallback`，就準備好可以一起 demo / 開發了。

`.venv/` 已經被 `.gitignore` 排除，不會 commit；其他人 clone 後也照這份重做即可。

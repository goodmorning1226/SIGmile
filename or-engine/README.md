# or-engine — Gurobi MTVRP solver

Next.js 主管端後台會用 `child_process.spawn` 呼叫這支：
```
python or-engine/solver_main.py < input.json > output.json
```

## 快速安裝（3 行）

在 repo 根目錄：

```powershell
cd or-engine
py -m venv .venv                          # 用 Python launcher 確保 Windows 對應正確版本
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

裝完後 Next.js **會自動偵測** `or-engine/.venv/Scripts/python.exe` 並使用它，
不用改 `.env.local`。**只要 dev server 重啟一次**。

Gurobi 需要 license（學術版 / 商業版皆可）；商業版裝完 `gurobipy` 後它會找 `gurobi.lic`。
參考 https://www.gurobi.com/downloads/end-user-license-agreement-academic/

## 進階：用其他 Python（可選）

如果你的 gurobipy 裝在 system Python / conda / 別的位置，
可以在 `apps/web/.env.local` 顯式指定：

```
# 顯式指定 Python 執行檔
OR_ENGINE_PYTHON=C:/Users/you/anaconda3/python.exe

# OR engine 程式碼位置（一般不用改，預設為 repo root 下的 or-engine/）
# OR_ENGINE_ROOT=D:/github/SIGmile/or-engine

# Solve timeout（秒）— 過久就走 mock fallback
OR_ENGINE_TIMEOUT_SEC=120
```

Python 解析順序（前面找不到才往後試）：
1. `OR_ENGINE_PYTHON` 環境變數
2. `or-engine/.venv/Scripts/python.exe`（自動偵測）
3. `or-engine/venv/Scripts/python.exe`（自動偵測）
4. `py`（Windows）／`python3`（其他）

## JSON I/O 格式

詳見 `solver_main.py` 開頭的 docstring。簡述：

**輸入**：depot 座標、stops（含 lat/lng、demand、service_minutes、shift）、
drivers（含 capacity、max_minutes、shift）、duration matrix `tau`（(n+1)×(n+1)
分鐘）、權重 α/β/γ、`num_trips`、`time_limit_sec`、`mip_gap`。

**輸出**：每位司機每趟的 stop sequence（含 `arrival_minute`、`service_minutes`、
`demand`）、總工時、加班、模型 status / gap / runtime。

## 不寫到 git

`/OR/` 是公司提供的原始 PDF/Excel/CSV，已加入 `.gitignore`。
`or-engine/` 才是 commit 進 repo 的程式碼。

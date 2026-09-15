# 小蒜頭人設收藏 Discord 機器人

跑在 Cloudflare Workers 上的 Discord 機器人，走 **HTTP Interactions** 模式 ——
不需要伺服器、不需要常駐連線、免費方案不會過期。

**要自己架一份？** 見 [docs/SETUP.md](docs/SETUP.md) —— 從零開始，約一小時，全程免費。

## 架構

Discord 在使用者打指令或按按鈕時，直接 POST 到你的 Worker 網址，Worker 回 JSON 就結束。
因為沒有常駐的 Gateway 連線，所以：

- ✅ 斜線指令、按鈕、下拉選單、彈窗
- ✅ 管理員主動觸發的操作（踢人、禁言、發身分組、清訊息）
- ❌ 一般聊天訊息、成員加入離開、語音狀態等伺服器事件

`discord.js` 在這個環境不能用（它需要 WebSocket 常駐連線），改用 `discord-interactions`
驗簽 + 直接呼叫 Discord REST API。

## 人設資料庫怎麼運作

人設資料放在 **一張** Google 試算表裡，**一個 Discord 伺服器對應一個分頁**。

```
Discord 指令
   ↓
Worker
   ├─ D1 guild_config  ← 這個伺服器用哪個分頁
   ├─ D1 sheet_cache   ← 快取分頁內容，TTL 5 分鐘
   └─ Google Sheets API（Service Account 讀取私人試算表）
```

分頁的第一列是標題列，需要 **人設名稱** 欄，以及 **中文提示詞** 或 **英文提示詞** 至少一欄。
**建立者** 欄選填，但 `/刪除人設` 需要它才能判斷誰有權刪除：

| 人設名稱 | 中文提示詞 | 英文提示詞 | 建立者 |
|---|---|---|---|
| 菜菜子 | 黑色雙馬尾，藍色髮尾 | black twin tails, blue tips | `1234567890123456789` |

建立者存的是 Discord 使用者 ID —— 顯示名稱會被改，ID 不會，權限判斷要能穩定比對。
Discord 上顯示時會自動轉成 `@名字`。
**修改與刪除都嚴格限定建立者本人，管理員也不能代為操作。**
沒有這一欄、或該列建立者為空的資料，任何人都不能用指令修改或刪除，只能直接編輯試算表。

**欄位是照名稱對應而不是照位置**，調換順序或改用英文標題（`name`／`zh`／`en`）都可以。
寫入時也會照偵測到的位置寫，不會因為欄位順序不同就寫錯格。

加入新伺服器時，一個指令搞定（分頁不存在會自動建立並填好標題列）：

```
/設定資料庫 群組名稱:<分頁名稱>
```

`/設定資料庫` 由各伺服器的**管理員**自行執行。所有伺服器共用同一張試算表，
因此有三道防止互相偷看的限制：

- **分頁本身記著自己屬於哪個伺服器**，不符就拒絕讀取。
  這個綁定寫在 Google 的隱藏元資料（developer metadata）裡，不佔儲存格、UI 看不到。
  比 D1 的登記可靠 —— D1 存的是分頁「名稱」，而名稱可以被改；
  分頁被改名、另一個分頁又剛好叫了原本的名字時，光靠名稱就會讀到別人的資料。
- **分頁被其他伺服器登記過就不能指過去**
- **非機器人擁有者只能建立新分頁，不能接上任何既有分頁** ——
  否則可以靠反覆嘗試名稱來探測別人的資料。例外是自己目前正在用的那一個。

分頁清單（`自動建立` 關閉且分頁不存在時的錯誤訊息）也只對機器人擁有者顯示。

綁定驗證發生在快取未命中與每次寫入前，每個伺服器最多五分鐘一次額外 API 呼叫。
綁定機制啟用前建立的分頁沒有綁定值，此時沿用舊行為不阻擋；
重跑一次 `/設定資料庫` 就會補上。

### 指令

| 指令 | 誰能用 | 作用 |
|---|---|---|
| `/人設 人設名稱 [語體]` | 所有人 | 查出該人設，可只看中文或只看英文。公開顯示 |
| `/新增人設 人設名稱 [中文] [英文]` | 所有人 | 名稱不可重複，中英文至少填一項 |
| `/修改人設 人設名稱 [中文] [英文]` | **只有建立者本人** | **留空的欄位保持原值**，不會被抹掉 |
| `/刪除人設 人設名稱` | **只有建立者本人** | 按鈕二次確認 |
| `/資料庫資訊` | 伺服器管理員 | 這個伺服器用哪個分頁、有幾筆資料 |
| `/使用紀錄 [筆數] [指令]` | 伺服器管理員 | 最近的指令紀錄 |
| `/重新整理資料庫` | 伺服器管理員 | 清快取並立即重讀 |
| `/設定資料庫 群組名稱` | 伺服器管理員 | 建立這個伺服器專屬的分頁 |
| `/help` | 所有人 | 功能說明 |

`/人設` 和 `/修改人設` 的名稱欄有自動完成，打字時 Discord 會列出試算表裡的名稱供點選。

`/help` 的指令清單是從 `commands/index.js` 動態產生的，新增指令不用另外維護它；
但概念說明的部分是手寫的，功能有大改時記得一併更新 `src/commands/help.js`。

### 機器人不需要任何 Discord 權限

斜線指令的回應本來就不需要權限，讀寫試算表也跟 Discord 權限無關，
所以邀請時 `permissions=0` 即可：

```
https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&permissions=0&scope=bot+applications.commands
```

表格裡的權限只是**預設值**。各伺服器的管理員可以在
**伺服器設定 → 整合 → 機器人** 逐指令覆寫誰能用、能在哪些頻道用，
不需要改程式也不用重新部署，而且各伺服器可以有不同設定。

### 使用紀錄

每次指令都會寫一筆到 D1 的 `command_log`：群組、時間、使用者、指令、修改內容。
修改類的指令記錄「改前 → 改後」，被擋下的操作（例如名稱重複）也會留下紀錄。

`/使用紀錄` 查看（限管理員，只看得到自己伺服器的）。

**紀錄保留 30 天**，由 Cron Trigger 每天 18:00 UTC（台灣凌晨 2 點）自動刪除過期資料。
保留天數改 `src/data/command-log.js` 的 `RETENTION_DAYS`。

### 快取

試算表改過內容後最多 5 分鐘生效，要立即生效用 `/重新整理資料庫`。
透過指令新增或修改時會自動清快取，所以不用等。

寫入前（檢查名稱重複、定位要改哪一列）一律略過快取直接讀試算表 ——
用過期資料判斷會誤判。

Google 暫時讀不到時，機器人會退回使用過期快取並在訊息裡標注，而不是整個功能停擺。

Google Service Account 的建立步驟見 [docs/google-setup.md](docs/google-setup.md)。

## 專案結構

```
src/
  index.js              Worker 進入點：驗簽 → 分派
  commands/
    index.js            指令註冊表（新增指令要來這裡加一行）
    ping.js             連線測試
    help.js             /help 功能說明
    persona.js          /人設 查詢，含名稱自動完成
    add-persona.js      /新增人設，含重複名稱檢查
    edit-persona.js     /修改人設，留空的欄位保持原值
    delete-persona.js   /刪除人設，限建立者本人，按鈕二次確認
    config-sheet.js     /設定資料庫 建立伺服器專屬分頁並寫入歸屬
    refresh-sheet.js    /重新整理資料庫 清快取並立即重讀
    db-info.js          /資料庫資訊
    log-view.js         /使用紀錄
  components/
    index.js            元件註冊表，用 custom_id 前綴分派
    delete-confirm.js   刪除確認鈕，點擊當下重新驗證建立者
    delete-cancel.js    取消鈕
  lib/
    respond.js          回應格式組裝
    discord.js          REST API 呼叫、查詢 App 擁有者
    google-auth.js      Web Crypto 自簽 RS256 JWT 換 Google access token
    sheets.js           Sheets API 讀寫、A1 語法組裝、標題列對應
  data/
    prompts.js          人設讀取、D1 快取與歸屬驗證
    guild-config.js     每個伺服器對應哪個分頁
    command-log.js      指令紀錄寫入、查詢與過期清理
    pending-delete.js   待確認的刪除請求（一次性 token，5 分鐘過期）
scripts/
  register-commands.js  把指令定義送到 Discord
schema.sql              D1 資料表結構
wrangler.jsonc          Worker 設定
```

## 初次設定

### 1. 準備 Discord 應用程式

到 [Developer Portal](https://discord.com/developers/applications) 建立 Application，
記下 **Application ID** 和 **Public Key**，再到 Bot 頁面 Reset Token 拿到 **Bot Token**。

```bash
cp .dev.vars.example .dev.vars
```

把三個值填進 `.dev.vars`，`DISCORD_GUILD_ID` 填你的測試伺服器 ID。

### 2. 建立 D1 資料庫

```bash
npx wrangler d1 create dutu-bot
```

把印出來的 `database_id` 貼進 `wrangler.jsonc`，然後建表：

```bash
npm run db:init
```

### 3. 註冊指令並部署

```bash
npm run register
npx wrangler secret put DISCORD_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_APPLICATION_ID
npm run deploy
```

### 4. 回填 Interactions Endpoint URL

把部署後拿到的網址（`https://dutu-bot.<你的帳號>.workers.dev`）填回
Developer Portal → General Information → **Interactions Endpoint URL**，按儲存。

Discord 會立刻送一個 PING 驗證，通過才存得起來。存不起來通常是 `DISCORD_PUBLIC_KEY` 填錯。

### 5. 邀請機器人進伺服器

Developer Portal → OAuth2 → URL Generator，只勾 `bot` + `applications.commands`，
**權限一個都不用勾**，用產生的網址邀請。這個機器人不需要任何 Discord 權限 ——
斜線指令的回應本來就不需要權限，讀寫試算表也跟 Discord 權限無關。

## 維運

```bash
npm run servers   # 列出所有伺服器、各自的分頁與使用狀況
```

`npm run hooks` 啟用提交前的金鑰掃描（每個 clone 的人都要跑一次）。
它會擋下含 Discord token、PEM 私鑰等樣式的提交，只回報位置不印出內容。

會標出需要處理的狀況：尚未設定、分頁不存在（被改名或刪除）、
分頁尚未綁定伺服器 ID、已設定但機器人已離開、沒有伺服器使用的孤兒分頁。

做成本機腳本而不是 Discord 指令，是因為它會揭露跨伺服器的資訊 ——
只有機器人擁有者該看得到，而擁有者本來就有這台機器的存取權。

**想把 `npm run servers` 搬到其他專案用**，要準備的檔案、環境變數與資料表
都列在 [`scripts/list-servers.mjs`](scripts/list-servers.mjs) 開頭。
注意它不只需要 Discord token，D1 的兩張表與試算表模組都是必要依賴。

## 開發

```bash
npm run dev     # 本機起 Worker
npm run tail    # 看線上即時日誌
```

本機開發時 Discord 打不到 `localhost`，需要用 `cloudflared tunnel --url http://localhost:8787`
之類的工具開一條臨時通道，把那個網址暫時填進 Interactions Endpoint URL。

## 新增指令

1. 在 `src/commands/` 建檔案，匯出 `data`（指令定義）和 `execute(interaction, env, ctx)`
2. 到 `src/commands/index.js` 加一行 import，並放進 `modules` 陣列
3. `npm run register && npm run deploy`

`execute` 必須回傳一個 `Response`。工作超過 3 秒的話，先回 `deferred()`，
把實際工作丟進 `ctx.waitUntil()`，做完用 `editOriginal()` 覆蓋佔位訊息 ——
`src/commands/prompt.js` 就是這個模式。

## 免費額度

| 項目 | 額度 |
|---|---|
| 請求數 | 10 萬次／天 |
| CPU 時間 | 每次請求 10ms（等外部回應不計入） |
| D1 | 5 GB |
| R2 物件儲存 | 10 GB，流量免費 |

## 注意

`.dev.vars` 內含 Bot Token，等同機器人的密碼，**絕對不要 commit**。
`.gitignore` 已經擋掉；萬一外洩就去 Developer Portal → Bot → Reset Token 立即重置。

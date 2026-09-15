# 從零架設這個機器人

這份手冊帶你把一個全新的機器人從無到有架起來。照著做大約一小時。

**全程免費。** Cloudflare Workers、D1、Google Sheets API 都在免費額度內，
不需要信用卡，也不會過期。

## 你需要的

- 一個 Discord 帳號，而且是某個伺服器的管理員
- 一個 Google 帳號
- 一個 Cloudflare 帳號（等下會建）
- 電腦上有 [Node.js](https://nodejs.org/) 20 以上

---

## 一、取得程式碼

```bash
git clone <這個 repo 的網址>
cd dutu-discord-bot
npm install
```

啟用金鑰防護（提交前會自動掃描，避免手滑把 token 送上 GitHub）：

```bash
npm run hooks
```

準備本機設定檔：

```bash
cp .dev.vars.example .dev.vars
```

接下來每一步拿到的值都填進這個檔案。它被 `.gitignore` 擋住，不會進版控。

---

## 二、建立 Discord 應用程式

1. 進 [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
2. 取個名字 → **Create**
3. 在 **General Information** 頁面記下兩個值：
   - **Application ID** → 填進 `.dev.vars` 的 `DISCORD_APPLICATION_ID`
   - **Public Key** → 填進 `DISCORD_PUBLIC_KEY`
4. 左側 **Bot** → **Reset Token** → 複製 → 填進 `DISCORD_TOKEN`

> ⚠️ Token 等同機器人的密碼。**只貼進 `.dev.vars`**，不要貼進任何聊天室、
> 不要貼進程式碼。外洩就回這裡 Reset 一次，舊的立刻失效。

5. 同樣在 **Bot** 頁面，如果想讓別人也能把機器人加進自己的伺服器，
   把 **Public Bot** 打開；只想自己用就關著。

---

## 三、建立 Google 服務帳戶

機器人需要一個「機器人專用的 Google 身分」來讀寫試算表。
詳細步驟見 [google-setup.md](google-setup.md)，摘要如下：

1. [Google Cloud Console](https://console.cloud.google.com/) → 新增專案
   （免費，**不需要綁信用卡**）
2. **API 和服務 → 程式庫** → 搜尋 `Google Sheets API` → 啟用
3. **IAM 與管理 → 服務帳戶** → 建立服務帳戶
   - **「授予專案存取權」那一步直接跳過，不要給任何角色。**
     Sheets 的權限是靠「把試算表分享給它」來授予的。
4. 點進去 → **金鑰** 分頁 → 新增金鑰 → **JSON** → 下載

把下載的 JSON 轉成可用的格式：

```bash
node scripts/prepare-google-key.mjs "下載的金鑰檔路徑.json"
```

它會把私鑰複製到剪貼簿、印出服務帳戶的 email。兩個都填進 `.dev.vars`：

- 剪貼簿內容 → `GOOGLE_SA_PRIVATE_KEY`
- 印出的 email → `GOOGLE_SA_EMAIL`

> 私鑰不會顯示在畫面上，避免留在終端機記錄裡。
> JSON 檔留在下載資料夾就好，**不要放進專案目錄**。

---

## 四、準備試算表

1. 建立一份新的 Google 試算表
2. 右上角 **共用** → 貼上服務帳戶的 email → 權限選 **編輯者** → 傳送

   > 必須是編輯者。機器人要建立分頁、寫入資料、記錄分頁歸屬，檢視權限不夠。
   > 服務帳戶不是真人帳號，不會收到通知信。

3. 從網址列複製試算表 ID，填進 `.dev.vars` 的 `PROMPT_SPREADSHEET_ID`：

   ```
   https://docs.google.com/spreadsheets/d/【這一段就是 ID】/edit
   ```

分頁的欄位結構不用手動建 —— 之後跑 `/設定資料庫` 時機器人會自動處理。

驗證認證有沒有通：

```bash
npm run check:google
```

看到「換發成功」就代表私鑰和服務帳戶都正確。

---

## 五、部署到 Cloudflare

註冊 [Cloudflare](https://dash.cloudflare.com/sign-up)（免費方案即可），然後：

```bash
npx wrangler login
```

建立資料庫：

```bash
npx wrangler d1 create dutu-bot
```

把印出來的 `database_id` 貼進 `wrangler.jsonc`，然後建立資料表：

```bash
npm run db:init
```

把 `wrangler.jsonc` 的 `vars` 區塊填上你自己的值：

| 變數 | 值 |
|---|---|
| `DISCORD_APPLICATION_ID` | 第二步的 Application ID |
| `DISCORD_PUBLIC_KEY` | 第二步的 Public Key |
| `GOOGLE_SA_EMAIL` | 第三步的服務帳戶 email |
| `PROMPT_SPREADSHEET_ID` | 第四步的試算表 ID |

> 這四個都不是機密：Public Key 的用途本來就是公開驗簽，
> 其他三個沒有對應的私鑰也做不了任何事。

**唯二的機密**用 secret 設定（會互動式詢問，貼上後按 Enter，畫面不會顯示）：

```bash
npx wrangler secret put DISCORD_TOKEN
```

```bash
npx wrangler secret put GOOGLE_SA_PRIVATE_KEY
```

部署：

```bash
npm run deploy
```

記下印出來的網址，形如 `https://dutu-bot.你的帳號.workers.dev`。

---

## 六、把網址告訴 Discord

回到 Developer Portal → **General Information** → **Interactions Endpoint URL**
→ 貼上剛才的網址 → **Save Changes**。

Discord 會當場送一個帶簽章的驗證請求，**存得起來就代表整條鏈路通了**。

存不起來的話，九成是 `DISCORD_PUBLIC_KEY` 填錯或還沒部署。

---

## 七、註冊指令

```bash
npm run register
```

預設註冊為**全域指令**（所有伺服器可用，Discord 端最多 1 小時生效）。

開發時想立即生效，在 `.dev.vars` 填 `DISCORD_GUILD_ID`（伺服器 ID，
可用逗號分隔多個），指令就只註冊到那些伺服器且馬上可用。
改完記得清空再跑一次，註冊回全域。

> 伺服器 ID 怎麼拿：Discord 設定 → 進階 → 開啟「開發者模式」，
> 然後對伺服器圖示按右鍵 → 複製伺服器 ID。

---

## 八、邀請機器人

把下面的網址裡的 `<APPLICATION_ID>` 換成你的：

```
https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&permissions=0&scope=bot+applications.commands
```

`permissions=0` 是刻意的 —— 這個機器人**不需要任何 Discord 權限**。
斜線指令的回應本來就不需要權限，讀寫試算表也跟 Discord 權限無關。

---

## 九、首次使用

在伺服器裡（需要「管理伺服器」權限）：

```
/設定資料庫 群組名稱:隨便取一個分頁名
```

機器人會在試算表建一個分頁、填好標題列、把這個伺服器綁定上去。

然後任何人都能用：

```
/新增人設 人設名稱:測試 中文提示詞:測試內容
/人設 人設名稱:測試
```

打 `/help` 看完整說明。

---

## 完成

到這裡機器人就能用了。之後的維運指令：

| 指令 | 用途 |
|---|---|
| `npm run servers` | 列出所有伺服器與使用狀況 |
| `npm run deploy` | 改完程式碼重新部署 |
| `npm run register` | 改完指令定義重新註冊 |
| `npm run tail` | 看線上即時日誌 |
| `npm run check:google` | 驗證 Google 認證 |

---

## 卡住的時候

| 現象 | 原因 |
|---|---|
| Endpoint URL 存不起來 | `DISCORD_PUBLIC_KEY` 填錯，或還沒 `npm run deploy` |
| 看不到斜線指令 | 全域註冊最多要等 1 小時；或邀請時漏勾 `applications.commands` |
| `/人設` 說還沒設定資料庫 | 該伺服器還沒跑過 `/設定資料庫` |
| 機器人存取不了試算表 | 沒把試算表分享給服務帳戶，或權限只給了「檢視者」 |
| `invalid_grant` | 私鑰貼錯或不完整，重跑 `prepare-google-key.mjs` |
| `API has not been used in project` | Google Sheets API 沒啟用 |
| PowerShell 說「無法載入 npx.ps1」 | 執行原則擋住了。跑 `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`，或改用 `npx.cmd` |
| `Required Worker name missing` | 不在專案目錄下跑 wrangler |

日誌是排查的第一站：

```bash
npm run tail
```

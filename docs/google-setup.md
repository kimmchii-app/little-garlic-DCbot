# Google Service Account 設定

機器人要讀私人試算表，需要一組「機器人專用的 Google 身分」—— 也就是 Service Account。
設定完之後，你只要把試算表分享給它的 email，機器人就讀得到，試算表不需要對外公開。

整個流程免費，**不需要綁信用卡**。Sheets API 有免費配額，不需要啟用帳單帳戶。

---

## 一、建立 GCP 專案

1. 進 <https://console.cloud.google.com/>
2. 頁面頂端的專案選單 → **新增專案**
3. 名稱隨意（例如 `dutu-bot-sheets`）→ **建立**
4. 建好後確認頂端專案選單已切換到這個新專案

> 這個專案只用來管 API 憑證，不會開任何運算資源，不會產生費用。

## 二、啟用 Google Sheets API

1. 左側選單 → **API 和服務** → **程式庫**
2. 搜尋 `Google Sheets API`
3. 點進去 → **啟用**

## 三、建立 Service Account

1. 左側選單 → **IAM 與管理** → **服務帳戶**
2. **建立服務帳戶**
3. 名稱填 `dutu-bot-reader`（帳戶 ID 會自動產生）→ **建立並繼續**
4. **「將專案存取權授予這個服務帳戶」這一步直接跳過**，按 **繼續**
5. 最後一步也跳過，按 **完成**

> 第 4 步很多人會卡住，想說要不要給什麼角色。**不用給**。
> Sheets 的存取權不是靠 IAM 角色，而是靠「你把試算表分享給它」來授予的。
> 給了多餘的角色反而擴大風險。

建好之後，清單上會出現一個 email，長得像：

```
dutu-bot-reader@你的專案id.iam.gserviceaccount.com
```

**這個 email 等一下要用兩次**，先複製起來。

## 四、產生金鑰

1. 點進剛建立的服務帳戶
2. 上方分頁 → **金鑰**
3. **新增金鑰** → **建立新的金鑰** → 選 **JSON** → **建立**
4. 瀏覽器會自動下載一個 `.json` 檔

> ⚠️ 這個 JSON 檔等同密碼，**不要放進專案資料夾**，也不要傳給任何人（包含貼進 AI 對話）。
> 放在下載資料夾就好，設定完可以刪掉。
> 萬一外流，回到「金鑰」分頁把它刪除即可，舊金鑰立刻失效。

## 五、把金鑰轉成 Worker 能用的格式

JSON 裡的私鑰是多行 PEM 格式，直接貼進 `wrangler secret put` 會因為換行出問題。
專案裡有個工具幫你轉成單行，**在你自己的終端機跑**：

```bash
node scripts/prepare-google-key.mjs "C:\Users\你的帳號\Downloads\那個檔名.json"
```

它會做三件事：

- 驗證 JSON 格式正確
- 把私鑰轉成單行、**直接複製到剪貼簿**（不會印在畫面上，避免留在終端機記錄裡）
- 把 `client_email` 印出來（這個不是機密）

## 六、設定到 Cloudflare

私鑰還在剪貼簿裡，直接貼上：

```bash
npx wrangler secret put GOOGLE_SA_PRIVATE_KEY
```

然後把上一步印出來的 `client_email` 填進 `wrangler.jsonc` 的 `vars.GOOGLE_SA_EMAIL`
（這不是機密，可以進版控）。

本機開發也要一份，填進 `.dev.vars`：

```
GOOGLE_SA_PRIVATE_KEY=剛才那串單行
GOOGLE_SA_EMAIL=dutu-bot-reader@你的專案id.iam.gserviceaccount.com
```

## 七、把試算表分享給機器人

1. 打開你的 Google 試算表
2. 右上角 **共用**
3. 貼上第三步那個 `...iam.gserviceaccount.com` 的 email
4. 權限選 **編輯者**
5. **傳送**

> **必須是編輯者，「檢視者」不夠。** `/設定資料庫` 要建立分頁並寫入分頁的歸屬記錄，
> `/新增人設`、`/修改人設`、`/刪除人設` 也都要寫入。
> 只給檢視權限的話，連初次設定都會失敗。

> 它不是真人帳號，不會收到通知信，直接分享就生效。

---

## 驗證

設定完跑一次連線測試：

```bash
npm run check:google
```

成功會顯示換發 token 成功與有效期限；失敗會告訴你是哪一環出錯。

---

## 常見錯誤

| 現象 | 原因 |
|---|---|
| `invalid_grant` | 私鑰貼錯或不完整，重跑第五步 |
| `Requested entity was not found` | 試算表 ID 錯了 |
| `The caller does not have permission` | 試算表沒分享給 Service Account，回到第七步 |
| `API has not been used in project` | 第二步的 Sheets API 沒啟用 |

---

## 安全性說明

- Service Account 拿到的是 `spreadsheets` scope：可以讀寫試算表，但**碰不到雲端硬碟的其他檔案**
  （沒有 `drive` scope），也**無法刪除整個試算表**。
- 它只存取得到「被明確分享給它」的試算表。有這組憑證不等於能看你整個雲端硬碟。
- 程式只用到三種寫入：新增分頁、寫標題列、在末尾附加一列。沒有任何刪除或覆蓋既有資料的路徑。
- 使用者輸入一律用 `valueInputOption=RAW` 寫入，`=IMPORTRANGE(...)` 這類內容會被當成
  純文字存進去，不會變成公式在你的試算表裡執行。這點已實測驗證。
- 真的出事時，Google 試算表本身有版本紀錄可以還原（檔案 → 版本記錄）。
- 私鑰只存在 Cloudflare secret 和你本機的 `.dev.vars`，兩者都不進版控。
- 之後開放給其他伺服器時，所有伺服器共用這一組 Service Account。
  這代表任何伺服器管理員只要知道某張「已分享給這個 SA」的試算表 ID，
  就能透過機器人讀到它。實務風險低（要先有人主動分享），但別把敏感資料放進同一組 SA 能讀的表。

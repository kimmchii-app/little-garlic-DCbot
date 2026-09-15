// 列出機器人目前所在的伺服器，以及各自的設定與使用狀況。
//
//   npm run servers
//
// 這是維運用的總覽，不做成 Discord 指令 —— 它會揭露跨伺服器的資訊，
// 只有機器人擁有者該看得到，而擁有者本來就有這台機器的存取權。
//
// ─────────────────────────────────────────────────────────────────────
// 搬到其他專案使用時要準備的東西
// ─────────────────────────────────────────────────────────────────────
//
// ⚠️ 先講清楚：這支腳本目前「不是」只要 Discord token 就能跑。
//    D1 查詢和試算表模組都是必要依賴，缺任何一個一執行就會出錯，
//    即使你只想看伺服器清單也一樣。以下「必要」的每一項都要到位。
//
// 【必要】環境
//   □ Node.js 20.12 以上（用到 process.loadEnvFile）
//   □ 從專案根目錄用 npm run servers 執行 ——
//     腳本用相對路徑找 node_modules/wrangler，在別的目錄跑會找不到
//
// 【必要】複製三個檔案，維持相同的相對位置
//   □ scripts/list-servers.mjs   （本檔）
//   □ src/lib/sheets.js          （本檔開頭 import 的）
//   □ src/lib/google-auth.js     （sheets.js 再 import 的，沒有其他依賴了）
//
// 【必要】package.json
//   □ scripts 加一行： "servers": "node scripts/list-servers.mjs"
//   □ devDependencies 要有 wrangler
//     （本檔是 .mjs，一定以 ES module 執行，不需要設 "type": "module"）
//
// 【必要】.dev.vars（放專案根目錄，務必加進 .gitignore）
//   □ DISCORD_TOKEN=機器人的 Bot Token
//     列出伺服器不需要任何 Discord 權限，有 token 就行
//
// 【必要】D1 資料庫
//   □ wrangler.jsonc 的 d1_databases 裡，binding 必須叫 "DB"
//     （資料庫本身取什麼名字都可以，這支腳本只認 binding）
//   □ 跑過 npx wrangler login（查的是線上資料庫 --remote）
//   □ 兩張表，至少要有這些欄位：
//       guild_config  guild_id TEXT、sheet_name TEXT、updated_at INTEGER
//       command_log   guild_id TEXT、created_at INTEGER
//     時間欄位存 Unix 秒數。建表語法可以直接抄本專案 schema.sql 的
//     guild_config 與 command_log 兩段。
//     你的專案若沒有這兩個概念，就得自己寫入對應資料，否則報表會是空的。
//
// 【選填】試算表檢查 —— 三個都填才會啟用，缺任何一個就整段略過
//   □ PROMPT_SPREADSHEET_ID=試算表網址中 /d/ 與 /edit 之間那段
//   □ GOOGLE_SA_EMAIL=服務帳戶 email
//   □ GOOGLE_SA_PRIVATE_KEY=由 scripts/prepare-google-key.mjs 轉出的單行私鑰
//   略過時報表照常列出伺服器，只是少了資料筆數、分頁不存在、
//   未綁定伺服器 ID、孤兒分頁這幾項檢查。
// ─────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fetchMetadata, fetchValues } from '../src/lib/sheets.js';

if (existsSync('.dev.vars')) process.loadEnvFile('.dev.vars');

const token = process.env.DISCORD_TOKEN;
const spreadsheetId = process.env.PROMPT_SPREADSHEET_ID;

if (!token) {
  console.error('缺少 DISCORD_TOKEN，請檢查 .dev.vars。');
  process.exit(1);
}

const env = {
  GOOGLE_SA_EMAIL: process.env.GOOGLE_SA_EMAIL,
  GOOGLE_SA_PRIVATE_KEY: process.env.GOOGLE_SA_PRIVATE_KEY,
};

/**
 * 對正式 D1 下查詢。透過 wrangler，因為 D1 不能從 Node 直接連。
 *
 * 直接跑 wrangler 的 JS 進入點而不是 npx —— Windows 上 Node 基於安全性
 * 不允許 spawn .cmd 檔，走 npx 會拿到 EINVAL。
 *
 * stdin 要用 inherit：設成 ignore 時 wrangler 取不到已登入的憑證，
 * 會回報帳號未授權。用 execFileSync 而非 shell，避免 SQL 裡的引號被吃掉。
 */
const WRANGLER = 'node_modules/wrangler/bin/wrangler.js';

// 用 binding 名稱而不是資料庫名稱：wrangler 的 d1 指令兩者都接受，
// 而 binding 是程式碼裡 env.DB 固定用的名字，自架者不會改它。
// 寫死資料庫名稱的話，只要 wrangler.jsonc 裡取了別的名字這支就會壞。
const D1_BINDING = 'DB';

function queryD1(sql) {
  const out = execFileSync(
    process.execPath,
    [WRANGLER, 'd1', 'execute', D1_BINDING, '--remote', '--json', '--command', sql],
    { encoding: 'utf8', stdio: ['inherit', 'pipe', 'ignore'] },
  );
  // wrangler 有時會在 JSON 前後夾雜其他輸出，取最外層的陣列
  const start = out.indexOf('[');
  const parsed = JSON.parse(out.slice(start));
  return parsed[0]?.results ?? [];
}

function timeAgo(unix) {
  if (!unix) return '—';
  const s = Math.floor(Date.now() / 1000) - unix;
  if (s < 3600) return `${Math.floor(s / 60)} 分鐘前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小時前`;
  return `${Math.floor(s / 86400)} 天前`;
}

console.log('讀取中…\n');

// --- Discord：機器人在哪些伺服器 ---
const guilds = await fetch('https://discord.com/api/v10/users/@me/guilds?with_counts=true', {
  headers: { authorization: `Bot ${token}` },
}).then((r) => r.json());

if (!Array.isArray(guilds)) {
  console.error('取得伺服器清單失敗：', guilds);
  process.exit(1);
}

// --- D1：設定與使用狀況 ---
const configs = queryD1('SELECT guild_id, sheet_name, updated_at FROM guild_config');
const activity = queryD1(
  `SELECT guild_id, COUNT(*) AS uses, MAX(created_at) AS last_used
   FROM command_log GROUP BY guild_id`,
);

const configOf = new Map(configs.map((c) => [c.guild_id, c]));
const activityOf = new Map(activity.map((a) => [a.guild_id, a]));

// --- 試算表：分頁、綁定與筆數 ---
let sheets = [];
const rowCount = new Map();

// 三個都要有才啟用。少了 email 也照樣去試的話，只會失敗後多印一行
// 意義不明的警告，不如直接略過。
if (spreadsheetId && env.GOOGLE_SA_EMAIL && env.GOOGLE_SA_PRIVATE_KEY) {
  try {
    sheets = (await fetchMetadata(env, spreadsheetId)).sheets;
    for (const name of new Set(configs.map((c) => c.sheet_name))) {
      if (!sheets.some((s) => s.title === name)) continue;
      const values = await fetchValues(env, { spreadsheetId, sheetName: name, cellRange: null });
      rowCount.set(name, Math.max(0, values.length - 1));
    }
  } catch (error) {
    console.warn(`讀取試算表失敗，略過分頁資訊：${error.message}\n`);
  }
}

const sheetTitles = new Set(sheets.map((s) => s.title));

// --- 報表 ---
console.log(`=== 機器人所在的伺服器（${guilds.length}）===\n`);

for (const g of guilds.sort((a, b) => a.name.localeCompare(b.name))) {
  const config = configOf.get(g.id);
  const act = activityOf.get(g.id);
  const members = g.approximate_member_count ?? '?';

  if (!config) {
    console.log(`⬜ ${g.name}　(${members} 人)`);
    console.log(`     尚未設定資料庫\n`);
    continue;
  }

  const sheet = sheets.find((s) => s.title === config.sheet_name);
  const problems = [];
  if (sheets.length > 0 && !sheetTitles.has(config.sheet_name)) {
    problems.push('分頁不存在（可能已被改名或刪除）');
  }
  if (sheet && !sheet.guildId) problems.push('分頁尚未綁定伺服器 ID');
  if (sheet && sheet.guildId && sheet.guildId !== g.id) problems.push('分頁綁定的是別的伺服器');

  console.log(`${problems.length ? '⚠️' : '✅'} ${g.name}　(${members} 人)`);
  console.log(
    `     分頁 ${config.sheet_name}　` +
      `${rowCount.has(config.sheet_name) ? `${rowCount.get(config.sheet_name)} 筆　` : ''}` +
      `使用 ${act?.uses ?? 0} 次　最後 ${timeAgo(act?.last_used)}`,
  );
  for (const p of problems) console.log(`     ⚠️ ${p}`);
  console.log('');
}

// --- 已設定但機器人已不在 ---
const liveIds = new Set(guilds.map((g) => g.id));
const gone = configs.filter((c) => !liveIds.has(c.guild_id));
if (gone.length > 0) {
  console.log(`=== 已設定但機器人已離開（${gone.length}）===\n`);
  for (const c of gone) {
    console.log(`  伺服器 ${c.guild_id}　分頁 ${c.sheet_name}　設定於 ${timeAgo(c.updated_at)}`);
  }
  console.log('');
}

// --- 沒有任何伺服器使用的分頁 ---
if (sheets.length > 0) {
  const used = new Set(configs.map((c) => c.sheet_name));
  const orphans = sheets.filter((s) => !used.has(s.title));
  console.log(`=== 沒有伺服器使用的分頁（${orphans.length}）===\n`);
  if (orphans.length === 0) {
    console.log('  （無）\n');
  } else {
    for (const s of orphans) console.log(`  ${s.title}`);
    console.log('\n  這些分頁的資料讀不到，確認不需要後可以在試算表刪掉。\n');
  }
}

// 把 src/commands/index.js 裡的指令定義送到 Discord。
// 每次新增指令、或改動指令的名稱／描述／參數之後，都要重跑：npm run register
//
// 注意這支是在你電腦上用 Node 跑的，不是在 Worker 裡跑。
import { existsSync } from 'node:fs';
import { commandList } from '../src/commands/index.js';

if (existsSync('.dev.vars')) {
  process.loadEnvFile('.dev.vars');
}

const token = process.env.DISCORD_TOKEN;
const appId = process.env.DISCORD_APPLICATION_ID;

// 可以用逗號分隔多個伺服器 ID，開發時想同時在幾個測試伺服器生效很方便。
// 留空則註冊為全域指令。
const guildIds = (process.env.DISCORD_GUILD_ID ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!token || !appId) {
  console.error('缺少 DISCORD_TOKEN 或 DISCORD_APPLICATION_ID，請檢查 .dev.vars。');
  process.exit(1);
}

// --clear：清空指令而不是註冊。
// 用途：從「伺服器指令」切換到「全域指令」時，要先把伺服器那份清掉，
// 否則該伺服器會同時看到兩份同名指令。
//   npm run register -- --clear    （清掉 .dev.vars 裡那個伺服器的指令）
const clear = process.argv.includes('--clear');
const payload = clear ? [] : commandList;

async function put(url, label) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { authorization: `Bot ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error(`${label} 失敗 ${res.status}：`, await res.text());
    return false;
  }

  const registered = await res.json();
  if (clear) {
    console.log(`${label}：已清空指令。`);
  } else {
    console.log(`${label}：已註冊 ${registered.length} 個指令`);
    for (const c of registered) console.log(`    /${c.name}`);
  }
  return true;
}

const base = `https://discord.com/api/v10/applications/${appId}`;
let ok = true;

if (guildIds.length === 0) {
  ok = await put(`${base}/commands`, '全域（最多等 1 小時生效）');
} else {
  for (const id of guildIds) {
    // 逐一處理而不是並行：一個伺服器失敗（例如機器人不在裡面）
    // 不該影響其他伺服器，而且要看得出是哪一個出問題
    const done = await put(`${base}/guilds/${id}/commands`, `伺服器 ${id}（立即生效）`);
    ok = ok && done;
  }
}

// 用 exitCode 而不是 process.exit()：在 Windows 上強制結束會讓
// 尚未關閉的 handle 觸發 libuv assertion，把成功的執行報成失敗
process.exitCode = ok ? 0 : 1;

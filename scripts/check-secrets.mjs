// 掃描即將 commit 的內容，攔下金鑰。由 .githooks/pre-commit 呼叫。
//
// 也可以手動跑：npm run check:secrets
//
// 設計原則：只回報「在哪一行、哪一類」，絕不印出實際內容 ——
// 印出來等於把金鑰寫進終端機記錄，反而擴大外洩面。
import { execFileSync } from 'node:child_process';

const PATTERNS = [
  ['Discord Bot Token', /[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/],
  ['PEM 私鑰區塊', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['PKCS#8 私鑰內容', /MII[A-Za-z0-9+/]{60,}/],
  ['Google API Key', /AIza[A-Za-z0-9_-]{35}/],
  ['AWS Access Key', /AKIA[A-Z0-9]{16}/],
  ['Slack Token', /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ['私鑰環境變數已填值', /^\+\s*GOOGLE_SA_PRIVATE_KEY\s*=\s*[A-Za-z0-9+/]{40,}/],
  ['Token 環境變數已填值', /^\+\s*DISCORD_TOKEN\s*=\s*[A-Za-z0-9_.-]{30,}/],
];

// 這個檔案本身含有上面那些樣式，會誤判自己
const SELF = 'scripts/check-secrets.mjs';

let diff;
try {
  diff = execFileSync('git', ['diff', '--cached', '--unified=0'], {
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
  });
} catch (error) {
  console.error('無法取得暫存的變更：', error.message);
  process.exit(1);
}

const findings = [];
let currentFile = '';

for (const line of diff.split('\n')) {
  if (line.startsWith('+++ b/')) {
    currentFile = line.slice(6);
    continue;
  }
  if (!line.startsWith('+') || line.startsWith('+++')) continue;
  if (currentFile === SELF) continue;

  for (const [name, re] of PATTERNS) {
    if (re.test(line)) findings.push({ file: currentFile, name });
  }
}

if (findings.length === 0) {
  process.exit(0);
}

console.error('\n🚫 commit 被擋下：暫存的變更裡疑似含有金鑰\n');
const seen = new Set();
for (const f of findings) {
  const key = `${f.file}|${f.name}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.error(`   ${f.file}　→　${f.name}`);
}
console.error('\n把金鑰移到 .dev.vars（已被 .gitignore 擋住）或 Cloudflare secret。');
console.error('確定是誤判的話，用 git commit --no-verify 略過。\n');

process.exitCode = 1;

// 把 Google Service Account 的 JSON 金鑰轉成 Worker secret 能用的單行字串。
//
//   node scripts/prepare-google-key.mjs <金鑰.json 的路徑>
//
// 私鑰只會進剪貼簿，不會印在畫面上 —— 避免留在終端機捲動記錄或 shell 歷史裡。
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const file = process.argv[2];
if (!file) {
  console.error('用法：node scripts/prepare-google-key.mjs <金鑰.json 的路徑>');
  process.exit(1);
}

let key;
try {
  key = JSON.parse(readFileSync(file, 'utf8'));
} catch (error) {
  console.error(`讀不到或解析失敗：${error.message}`);
  process.exit(1);
}

if (key.type !== 'service_account') {
  console.error(`這不像 Service Account 金鑰（type 是 "${key.type}"）。`);
  process.exit(1);
}
if (!key.private_key || !key.client_email) {
  console.error('金鑰檔缺少 private_key 或 client_email。');
  process.exit(1);
}

// PEM 的本體本身就是 DER 的 base64，去掉頭尾與換行就是我們要的單行字串。
// Worker 端只要 atob() 一次就得到 DER，可以直接餵給 importKey('pkcs8', ...)。
const oneLine = key.private_key
  .replace(/-----BEGIN [^-]+-----/, '')
  .replace(/-----END [^-]+-----/, '')
  .replace(/\s+/g, '');

if (!/^[A-Za-z0-9+/]+={0,2}$/.test(oneLine)) {
  console.error('私鑰內容不是預期的 base64 格式，金鑰檔可能損壞。');
  process.exit(1);
}

// --print：只把私鑰本身送到 stdout，不輸出任何說明文字，供管線使用。
if (process.argv.includes('--print')) {
  process.stdout.write(oneLine);
  process.exit(0);
}

function copyToClipboard(text) {
  return new Promise((resolve) => {
    const cmd =
      process.platform === 'win32' ? 'clip'
      : process.platform === 'darwin' ? 'pbcopy'
      : 'xclip';
    const args = process.platform === 'linux' ? ['-selection', 'clipboard'] : [];

    const child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
    child.stdin.end(text);
  });
}

const copied = await copyToClipboard(oneLine);

console.log('金鑰解析成功。');
console.log(`  專案：${key.project_id}`);
console.log(`  長度：${oneLine.length} 字元`);
console.log('');
console.log('GOOGLE_SA_EMAIL（非機密，填進 wrangler.jsonc 的 vars）：');
console.log(`  ${key.client_email}`);
console.log('');

if (copied) {
  console.log('私鑰已複製到剪貼簿。接著跑：');
  console.log('  npx wrangler secret put GOOGLE_SA_PRIVATE_KEY');
  console.log('提示出現後直接貼上（Ctrl+V）再按 Enter。');
} else {
  console.log('⚠️ 複製到剪貼簿失敗。可以改用管線直接送進去，避免私鑰出現在畫面上：');
  console.log(
    `  node scripts/prepare-google-key.mjs "${file}" --print | npx wrangler secret put GOOGLE_SA_PRIVATE_KEY`,
  );
}

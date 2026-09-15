// 驗證 Google Service Account 設定是否正確。
//
//   npm run check:google
//
// 直接呼叫 src/lib/google-auth.js，跟 Worker 用的是同一份程式碼。
// Node 24 的 Web Crypto 與 workerd 都實作同一套標準 API，所以這裡能過，
// 表示簽章邏輯本身沒問題。
//
// 注意：這支在 Node 跑，沒有 D1 可用，所以會跳過快取直接向 Google 換發。
// 要確認在真正的 Workers 執行環境也沒問題，另外跑：
//   npx wrangler dev  然後開 http://localhost:8787/_diag/google
import { existsSync } from 'node:fs';
import { getAccessToken } from '../src/lib/google-auth.js';

if (existsSync('.dev.vars')) {
  process.loadEnvFile('.dev.vars');
}

const env = {
  GOOGLE_SA_EMAIL: process.env.GOOGLE_SA_EMAIL,
  GOOGLE_SA_PRIVATE_KEY: process.env.GOOGLE_SA_PRIVATE_KEY,
  // 沒有 DB，google-auth.js 的快取讀寫會靜默略過
};

if (!env.GOOGLE_SA_EMAIL || !env.GOOGLE_SA_PRIVATE_KEY) {
  console.error('缺少 GOOGLE_SA_EMAIL 或 GOOGLE_SA_PRIVATE_KEY，請檢查 .dev.vars。');
  console.error('設定步驟見 docs/google-setup.md');
  process.exit(1);
}

console.log(`Service Account：${env.GOOGLE_SA_EMAIL}`);
console.log('正在向 Google 換發 access token…\n');

try {
  const started = Date.now();
  const token = await getAccessToken(env);
  const elapsed = Date.now() - started;

  console.log('✅ 換發成功');
  console.log(`   耗時 ${elapsed}ms，token 長度 ${token.length} 字元`);
  console.log('\nRS256 簽章與 Service Account 憑證都正確。');
  console.log('接下來要驗的是「試算表有沒有分享給這個 email」—— 那是讀取時才會檢查的。');
} catch (error) {
  console.error(`❌ 失敗：${error.message}`);
  console.error('\n對照 docs/google-setup.md 的「常見錯誤」一節排查。');
  process.exit(1);
}

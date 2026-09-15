// Google Service Account 認證。
//
// Workers 沒有 Node 的 crypto 模組，所以不能用現成的 googleapis 套件。
// 改用 Web Crypto 自己簽 RS256 JWT，再跟 Google 換 access token。
//
// token 是綁 Service Account 而不是綁伺服器，所有 Discord 伺服器共用同一份，
// 因此快取在 D1 裡，一小時只需換發一次。

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// 需要寫入權限：自動建立分頁、用指令新增提示詞。
// 這個 scope 只涵蓋試算表，不含雲端硬碟其他檔案；
// 而且服務帳戶仍然只碰得到「被明確分享給它」的試算表。
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

// 快取鍵帶上 scope，這樣日後調整 scope 時舊 token 不會被誤用
const CACHE_ID = 'google:spreadsheets';
const JWT_TTL = 3600;
// 提前這麼多秒換發，避免 token 在請求進行到一半時剛好過期
const RENEW_MARGIN = 300;

function base64url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeSegment(obj) {
  return base64url(new TextEncoder().encode(JSON.stringify(obj)));
}

/**
 * secret 存的是「PEM 去掉頭尾與換行」的單行 base64，
 * 而 PEM 本體本來就是 DER 的 base64，所以解碼一次就得到可直接匯入的 DER。
 * 轉換由 scripts/prepare-google-key.mjs 產生。
 */
async function importPrivateKey(oneLineBase64) {
  const clean = oneLineBase64.replace(/\s+/g, '');
  let binary;
  try {
    binary = atob(clean);
  } catch {
    throw new Error('GOOGLE_SA_PRIVATE_KEY 不是合法的 base64，請重跑 prepare-google-key.mjs');
  }

  const der = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) der[i] = binary.charCodeAt(i);

  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function mintAssertion(env) {
  const now = Math.floor(Date.now() / 1000);

  const unsigned =
    encodeSegment({ alg: 'RS256', typ: 'JWT' }) +
    '.' +
    encodeSegment({
      iss: env.GOOGLE_SA_EMAIL,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + JWT_TTL,
    });

  const key = await importPrivateKey(env.GOOGLE_SA_PRIVATE_KEY);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );

  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
}

async function requestToken(env) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: await mintAssertion(env),
    }),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    // Google 這裡的錯誤訊息很簡略，補上最常見的成因方便排查
    const hint =
      body.error === 'invalid_grant'
        ? '（私鑰或 client_email 可能不正確）'
        : body.error === 'invalid_client'
          ? '（GOOGLE_SA_EMAIL 不存在或已被刪除）'
          : '';
    throw new Error(`Google 換發 token 失敗 ${res.status} ${body.error ?? ''}${hint}`);
  }

  return {
    token: body.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + (body.expires_in ?? JWT_TTL) - RENEW_MARGIN,
  };
}

async function readCache(env) {
  // 沒有 D1 綁定就是沒有快取可用（例如在 Node 裡跑 check:google），
  // 這是正常情況，不該當成錯誤處理
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT access_token, expires_at FROM token_cache WHERE id = ?1`,
    )
      .bind(CACHE_ID)
      .first();
    if (!row) return null;
    if (row.expires_at <= Math.floor(Date.now() / 1000)) return null;
    return row.access_token;
  } catch {
    // 快取表不存在或讀取失敗都不該讓功能整個掛掉，退回直接換發
    return null;
  }
}

async function writeCache(env, token, expiresAt) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO token_cache (id, access_token, expires_at) VALUES (?3, ?1, ?2)
       ON CONFLICT(id) DO UPDATE SET access_token = ?1, expires_at = ?2`,
    )
      .bind(token, expiresAt, CACHE_ID)
      .run();
  } catch (error) {
    console.warn('token 快取寫入失敗，不影響本次請求：', error);
  }
}

/** 取得可用的 Google access token，優先用快取 */
export async function getAccessToken(env) {
  if (!env.GOOGLE_SA_EMAIL || !env.GOOGLE_SA_PRIVATE_KEY) {
    throw new Error('尚未設定 GOOGLE_SA_EMAIL 或 GOOGLE_SA_PRIVATE_KEY，見 docs/google-setup.md');
  }

  const cached = await readCache(env);
  if (cached) return cached;

  const { token, expiresAt } = await requestToken(env);
  await writeCache(env, token, expiresAt);
  return token;
}

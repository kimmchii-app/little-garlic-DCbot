// 等待二次確認的刪除請求。
//
// 按鈕的 custom_id 只帶一個短 token，真正的內容存在 D1：
// custom_id 有 100 字元上限，而人設名稱本身就可能到 100 字元。
// 用 token 對應還有一個好處 —— 可以設定過期，避免翻舊訊息按到很久以前的確認鈕。

const TTL = 300; // 秒

function now() {
  return Math.floor(Date.now() / 1000);
}

export async function createPendingDelete(env, { guildId, userId, name }) {
  const token = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO pending_deletes (token, guild_id, user_id, name, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(token, guildId, userId, name, now() + TTL)
    .run();
  return token;
}

/** 取出並刪除（一次性使用，避免重複點擊造成重複刪除） */
export async function consumePendingDelete(env, token) {
  const row = await env.DB.prepare(`SELECT * FROM pending_deletes WHERE token = ?1`)
    .bind(token)
    .first();

  if (!row) return null;

  await env.DB.prepare(`DELETE FROM pending_deletes WHERE token = ?1`).bind(token).run();

  if (row.expires_at <= now()) return { expired: true };
  return { guildId: row.guild_id, userId: row.user_id, name: row.name };
}

export async function purgeExpiredPendingDeletes(env) {
  const result = await env.DB.prepare(`DELETE FROM pending_deletes WHERE expires_at < ?1`)
    .bind(now())
    .run();
  return result.meta?.changes ?? 0;
}

export const PENDING_TTL_SECONDS = TTL;

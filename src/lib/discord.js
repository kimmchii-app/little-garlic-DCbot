// Discord REST API 的薄封裝。
// Workers 上不能用 discord.js（它要常駐 WebSocket 連線），所以直接打 HTTP。
const API = 'https://discord.com/api/v10';

/** 以機器人身分呼叫 API */
export async function rest(env, method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      authorization: `Bot ${env.DISCORD_TOKEN}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Discord API ${method} ${path} → ${res.status}: ${await res.text()}`);
  }
  // 多數寫入操作回 204 No Content
  return res.status === 204 ? null : res.json();
}

/**
 * 取得這個 App 的擁有者 ID 集合。
 *
 * 用來把某些指令限制成「只有機器人擁有者能用」—— Discord 的
 * default_member_permissions 只能表達伺服器層級的權限，無法表達這件事。
 *
 * 向 Discord 即時查詢而不是寫死在設定裡，這樣轉移 App 擁有權之後不用改程式。
 * 團隊持有的 App 會把所有團隊成員都算進去。
 */
export async function fetchAppOwnerIds(env) {
  const app = await rest(env, 'GET', '/oauth2/applications/@me');
  const ids = new Set();
  if (app.owner?.id) ids.add(app.owner.id);
  for (const member of app.team?.members ?? []) {
    if (member.user?.id) ids.add(member.user.id);
  }
  return ids;
}

/**
 * 覆蓋先前用 deferred() 送出的佔位訊息。
 * 這支走 webhook 路徑，用 interaction token 授權，不需要 bot token。
 * token 有效期 15 分鐘。
 */
export async function editOriginal(env, interactionToken, data) {
  const url = `${API}/webhooks/${env.DISCORD_APPLICATION_ID}/${interactionToken}/messages/@original`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(`更新原始回應失敗 → ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

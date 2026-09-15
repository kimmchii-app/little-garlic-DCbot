import { InteractionType, InteractionResponseType, verifyKey } from 'discord-interactions';
import { commands } from './commands/index.js';
import { resolveComponent } from './components/index.js';
import { json, reply } from './lib/respond.js';
import { getAccessToken } from './lib/google-auth.js';
import { purgeOldLogs, RETENTION_DAYS } from './data/command-log.js';
import { purgeExpiredPendingDeletes } from './data/pending-delete.js';

export default {
  /**
   * 每日排程（見 wrangler.jsonc 的 triggers.crons）：清掉過期資料。
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          const { deleted } = await purgeOldLogs(env);
          console.log(`排程清理：刪除 ${deleted} 筆超過 ${RETENTION_DAYS} 天的指令紀錄`);
        } catch (error) {
          console.error('清理指令紀錄失敗：', error);
        }

        try {
          const removed = await purgeExpiredPendingDeletes(env);
          if (removed > 0) console.log(`排程清理：刪除 ${removed} 筆逾時的刪除確認`);
        } catch (error) {
          console.error('清理刪除確認失敗：', error);
        }
      })(),
    );
  },

  async fetch(request, env, ctx) {
    // 瀏覽器直接打開這個網址時給個健康檢查回應
    if (request.method === 'GET') {
      if (new URL(request.url).pathname === '/_diag/google') {
        return diagGoogle(env);
      }
      return new Response('小蒜頭運作中 🧄');
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const body = await request.text();

    // 這一步不能省。沒有驗簽的話，任何人知道網址就能假冒 Discord
    // 呼叫你的機器人去踢人、發身分組。
    const signature = request.headers.get('x-signature-ed25519');
    const timestamp = request.headers.get('x-signature-timestamp');
    const valid =
      signature &&
      timestamp &&
      (await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY));

    if (!valid) {
      return new Response('Bad request signature', { status: 401 });
    }

    const interaction = JSON.parse(body);

    switch (interaction.type) {
      // Discord 會定期打這個確認端點還活著，也用在設定 Endpoint URL 時的驗證
      case InteractionType.PING:
        return json({ type: InteractionResponseType.PONG });

      case InteractionType.APPLICATION_COMMAND: {
        const command = commands.get(interaction.data.name);
        if (!command) {
          console.warn(`收到未知指令：${interaction.data.name}`);
          return reply('這個指令已經不存在囉', { ephemeral: true });
        }
        return guard(() => command.execute(interaction, env, ctx), interaction.data.name);
      }

      // 使用者正在輸入參數。沒有 defer 可用，必須 3 秒內回應，
      // 任何失敗都回空清單而不是錯誤 —— 壞掉的建議清單會讓整個輸入框卡住。
      case InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE: {
        const command = commands.get(interaction.data.name);
        if (!command?.autocomplete) return emptyChoices();
        try {
          return await command.autocomplete(interaction, env, ctx);
        } catch (error) {
          console.error(`自動完成 ${interaction.data.name} 失敗：`, error);
          return emptyChoices();
        }
      }

      case InteractionType.MESSAGE_COMPONENT: {
        const handler = resolveComponent(interaction.data.custom_id);
        if (!handler) {
          console.warn(`收到未知元件：${interaction.data.custom_id}`);
          return reply('這個按鈕已經失效囉', { ephemeral: true });
        }
        return guard(() => handler.execute(interaction, env, ctx), interaction.data.custom_id);
      }

      default:
        return json({ type: InteractionResponseType.PONG });
    }
  },
};

function emptyChoices() {
  return json({
    type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
    data: { choices: [] },
  });
}

/**
 * 在真正的 Workers 執行環境驗證 Google 認證是否可用。
 *
 * 只在 .dev.vars 設了 ALLOW_DIAG=1 時開放，正式環境沒有這個變數 → 一律 404，
 * 避免對外多開一個可探測內部狀態的端點。
 */
async function diagGoogle(env) {
  if (env.ALLOW_DIAG !== '1') {
    return new Response('Not found', { status: 404 });
  }
  try {
    const token = await getAccessToken(env);
    return json({ ok: true, tokenLength: token.length, sa: env.GOOGLE_SA_EMAIL });
  } catch (error) {
    return json({ ok: false, error: error.message }, { status: 500 });
  }
}

// 任何處理器丟出例外時，仍然要回一個合法的回應，
// 否則使用者看到的是「應用程式沒有回應」這種無資訊的錯誤。
async function guard(fn, label) {
  try {
    return await fn();
  } catch (error) {
    console.error(`處理 ${label} 時出錯：`, error);
    return reply('出了點狀況，等一下再試試 🙏', { ephemeral: true });
  }
}

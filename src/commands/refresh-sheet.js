import { deferred } from '../lib/respond.js';
import { editOriginal } from '../lib/discord.js';
import { clearCache, loadPrompts, NotConfiguredError } from '../data/prompts.js';
import { SheetError } from '../lib/sheets.js';
import { logCommand } from '../data/command-log.js';

const MANAGE_GUILD = 1 << 5;

export const data = {
  name: '重新整理資料庫',
  description: '立即重新讀取試算表，不等快取過期',
  default_member_permissions: String(MANAGE_GUILD),
  dm_permission: false,
};

export async function execute(interaction, env, ctx) {
  ctx.waitUntil(run(interaction, env));
  return deferred({ ephemeral: true });
}

async function run(interaction, env) {
  const say = (content) => editOriginal(env, interaction.token, { content }).catch(() => {});

  try {
    await clearCache(env, interaction.guild_id);
    // 清完立刻重讀一次，這樣管理員當場就知道新內容有沒有問題，
    // 而不是把錯誤留給下一個打 /人設 的人踩到
    const { records } = await loadPrompts(env, interaction.guild_id);
    await logCommand(env, interaction, '重新整理資料庫', `清快取後重讀，${records.length} 筆`);
    return say(`🔄 重新讀好囉！目前 ${records.length} 筆人設`);
  } catch (error) {
    if (error instanceof NotConfiguredError) {
      return say('這裡還沒有資料庫！請伺服器管理員跑一次 `/設定資料庫` 就能開始用 ✨');
    }
    if (error instanceof SheetError) {
      return say(`❌ 讀取失敗：${error.message}`);
    }
    console.error('重新整理資料庫失敗：', error);
    return say('❌ 重新整理失敗，等一下再試試 🙏');
  }
}

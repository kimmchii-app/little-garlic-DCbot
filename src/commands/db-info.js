import { deferred } from '../lib/respond.js';
import { editOriginal } from '../lib/discord.js';
import { SheetError } from '../lib/sheets.js';
import { getGuildConfig } from '../data/guild-config.js';
import { loadPrompts, NotConfiguredError } from '../data/prompts.js';

const MANAGE_GUILD = 1 << 5;

export const data = {
  name: '資料庫資訊',
  description: '看這個伺服器目前連到哪個分頁、有幾筆資料',
  default_member_permissions: String(MANAGE_GUILD),
  dm_permission: false,
};

export async function execute(interaction, env, ctx) {
  ctx.waitUntil(run(interaction, env));
  return deferred({ ephemeral: true });
}

function timeAgo(unixSeconds) {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分鐘前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小時前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

async function run(interaction, env) {
  const say = (content) => editOriginal(env, interaction.token, { content }).catch(() => {});

  try {
    // 只回報這個伺服器自己的設定。試算表裡其他分頁的存在與用途
    // 跟這個伺服器無關，也不該從這裡外洩。
    const config = await getGuildConfig(env, interaction.guild_id);
    if (!config) {
      return say('這裡還沒有資料庫！請伺服器管理員跑一次 `/設定資料庫` 就能開始用 ✨');
    }

    const fields = [
      {
        name: '目前使用的分頁',
        value: `\`${config.sheetName}\`${config.cellRange ? `　範圍 \`${config.cellRange}\`` : '（整個分頁）'}`,
      },
      {
        name: '設定時間',
        value: `${timeAgo(config.updatedAt)}${config.updatedBy ? `　由 <@${config.updatedBy}>` : ''}`,
      },
    ];

    // 讀不到試算表時仍然要能看到設定，所以資料筆數獨立處理
    try {
      const { records, stale, fetchedAt } = await loadPrompts(env, interaction.guild_id);
      fields.push({
        name: '資料筆數',
        value: `${records.length} 筆　（讀取於 ${timeAgo(fetchedAt)}${stale ? '，目前讀不到試算表' : ''}）`,
      });
    } catch (error) {
      fields.push({
        name: '資料筆數',
        value: `讀取失敗：${error instanceof SheetError ? error.message : '未知錯誤'}`,
      });
    }

    await editOriginal(env, interaction.token, {
      embeds: [
        {
          title: '📋 資料庫設定',
          color: 0x5865f2,
          fields,
          footer: { text: '改動試算表後最多 5 分鐘生效，要立即生效用 /重新整理資料庫' },
        },
      ],
    });
  } catch (error) {
    if (error instanceof NotConfiguredError) {
      return say('這裡還沒有資料庫！請伺服器管理員跑一次 `/設定資料庫` 就能開始用 ✨');
    }
    console.error('查詢資料庫資訊失敗：', error);
    return say('查詢出了點狀況，等一下再試試 🙏');
  }
}

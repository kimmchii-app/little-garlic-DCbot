import { deferred, option, focusedOption, autocompleteChoices } from '../lib/respond.js';
import { editOriginal } from '../lib/discord.js';
import { SheetError } from '../lib/sheets.js';
import { loadForWrite, findRecord, suggestNames, NotConfiguredError } from '../data/prompts.js';
import { createPendingDelete, PENDING_TTL_SECONDS } from '../data/pending-delete.js';

export const data = {
  name: '刪除人設',
  description: '刪除自己建立的人設（只有建立者本人可以刪）',
  dm_permission: false,
  options: [
    {
      type: 3,
      name: '人設名稱',
      description: '開始打字會列出可選的名稱',
      required: true,
      autocomplete: true,
    },
  ],
};

export async function execute(interaction, env, ctx) {
  ctx.waitUntil(run(interaction, env));
  return deferred({ ephemeral: true });
}

export async function autocomplete(interaction, env) {
  try {
    const { value } = focusedOption(interaction);
    return autocompleteChoices(await suggestNames(env, interaction.guild_id, value));
  } catch (error) {
    console.warn('刪除人設自動完成失敗：', error);
    return autocompleteChoices([]);
  }
}

function preview(text) {
  const value = String(text ?? '').trim();
  if (!value) return '（還沒填）';
  return value.length > 200 ? `${value.slice(0, 200)}…` : value;
}

async function run(interaction, env) {
  const say = (content) => editOriginal(env, interaction.token, { content }).catch(() => {});

  const name = String(option(interaction, '人設名稱', '')).trim();
  const userId = interaction.member?.user?.id ?? '';

  if (!name) return say('要刪誰呢？請指定人設名稱');

  try {
    // 讀最新資料：建立者和列號都必須是當下的真實狀態
    const { records, cols } = await loadForWrite(env, interaction.guild_id);

    const target = findRecord(records, name);
    if (!target) {
      return say(`翻遍了都沒看到「${name}」🔍`);
    }

    if (cols.author < 0) {
      return say(
        [
          '這個分頁沒有「建立者」欄，無法判斷誰有權刪除。',
          '請管理員在試算表的標題列加上 `建立者` 這一欄。',
        ].join('\n'),
      );
    }

    // 嚴格本人限定 —— 管理員也不能代刪
    if (!target.author) {
      return say(`「${target.name}」沒有記錄建立者，認不出主人，所以不能用指令刪除。`);
    }

    if (target.author !== userId) {
      // 不點出建立者是誰 —— 使用者需要知道的只是「不是你的」
      return say(`「${target.name}」是別人建的，只有本人能刪喔 🔒`);
    }

    const token = await createPendingDelete(env, {
      guildId: interaction.guild_id,
      userId,
      name: target.name,
    });

    await editOriginal(env, interaction.token, {
      content: [
        `即將刪除 **#${target.id} ${target.name}**`,
        `中文：${preview(target.zh)}`,
        `英文：${preview(target.en)}`,
        '',
        `-# 刪除後無法透過機器人復原，${Math.floor(PENDING_TTL_SECONDS / 60)} 分鐘內有效`,
      ].join('\n'),
      components: [
        {
          type: 1,
          components: [
            { type: 2, style: 4, label: '確認刪除', custom_id: `delok:${token}` },
            { type: 2, style: 2, label: '取消', custom_id: `delno:${token}` },
          ],
        },
      ],
    });
  } catch (error) {
    if (error instanceof NotConfiguredError) {
      return say('這裡還沒有資料庫！請伺服器管理員跑一次 `/設定資料庫` 就能開始用 ✨');
    }
    if (error instanceof SheetError) {
      return say(`❌ 讀取失敗：${error.message}`);
    }
    console.error('刪除人設失敗：', error);
    return say('❌ 出了點狀況，等一下再試試 🙏');
  }
}

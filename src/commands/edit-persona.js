import { deferred, option, focusedOption, autocompleteChoices } from '../lib/respond.js';
import { editOriginal } from '../lib/discord.js';
import { updateRecordCells } from '../lib/sheets.js';
import {
  loadForWrite,
  findRecord,
  suggestNames,
  clearCache,
} from '../data/prompts.js';
import { explain } from './add-persona.js';
import { logCommand } from '../data/command-log.js';

/** 紀錄用：長內容截短，並把空值寫成看得懂的字 */
function brief(text) {
  const value = String(text ?? '');
  if (!value) return '（還沒填）';
  return value.length > 60 ? `${value.slice(0, 60)}…` : value;
}

const MAX_PROMPT = 2000;

export const data = {
  name: '修改人設',
  description: '修改自己建立的人設（只有建立者本人可以改）',
  dm_permission: false,
  options: [
    {
      type: 3,
      name: '人設名稱',
      description: '開始打字會列出可選的名稱',
      required: true,
      autocomplete: true,
    },
    // 留空 = 保持原值。要清空得明確用「清空」參數，
    // 否則只想改中文的人會不小心把英文抹掉。
    { type: 3, name: '中文提示詞', description: '留空則保持原值', required: false },
    { type: 3, name: '英文提示詞', description: '留空則保持原值', required: false },
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
    console.warn('修改人設自動完成失敗：', error);
    return autocompleteChoices([]);
  }
}

async function run(interaction, env) {
  const say = (content) => editOriginal(env, interaction.token, { content }).catch(() => {});

  const name = String(option(interaction, '人設名稱', '')).trim();
  const userId = interaction.member?.user?.id ?? '';
  const zhInput = option(interaction, '中文提示詞');
  const enInput = option(interaction, '英文提示詞');

  const zh = zhInput === null ? null : String(zhInput).trim();
  const en = enInput === null ? null : String(enInput).trim();

  if (!name) return say('要改誰呢？請指定人設名稱 ✏️');
  if (zh === null && en === null) {
    return say('要改什麼呢？中文或英文至少填一個');
  }
  if (zh !== null && zh.length > MAX_PROMPT) return say(`中文提示詞太長啦，上限 ${MAX_PROMPT} 字 ✂️`);
  if (en !== null && en.length > MAX_PROMPT) return say(`英文提示詞太長啦，上限 ${MAX_PROMPT} 字 ✂️`);

  try {
    // 讀最新資料：要拿到正確的列號才能寫對地方，快取可能已經跟試算表不同步
    const { records, cols, config } = await loadForWrite(env, interaction.guild_id);

    const target = findRecord(records, name);
    if (!target) {
      const near = records
        .filter((r) => r.name.toLowerCase().includes(name.toLowerCase()))
        .slice(0, 5);
      if (near.length > 0) {
        return say(
          [`沒有完全叫「${name}」的耶，你是不是想改這些？`, ...near.map((r) => `• ${r.name}`)].join('\n'),
        );
      }
      return say(`翻遍了都沒看到「${name}」🔍 想新增的話用 \`/新增人設\``);
    }

    // 與 /刪除人設 同一套規則：嚴格建立者本人，管理員也不能代改
    if (cols.author < 0) {
      return say(
        [
          '這個分頁沒有「建立者」欄，無法判斷誰有權修改。',
          '請管理員在試算表的標題列加上 `建立者` 這一欄。',
        ].join('\n'),
      );
    }
    if (!target.author) {
      return say(`「${target.name}」沒有記錄建立者，認不出主人，所以不能用指令修改。`);
    }
    if (target.author !== userId) {
      return say(`「${target.name}」是別人建的，只有本人能改喔 🔒`);
    }

    const fields = {};
    if (zh !== null) fields.zh = zh;
    if (en !== null) fields.en = en;

    const changed = await updateRecordCells(env, config, cols, target.id, fields);
    if (changed === 0) {
      return say('這個分頁沒有對應的欄位可以寫入，請檢查標題列。');
    }

    await clearCache(env, interaction.guild_id);

    const after = { zh: zh ?? target.zh, en: en ?? target.en };
    const mark = (key) => (fields[key] !== undefined ? '（已更新）' : '（未更動）');

    // 紀錄改前改後 —— 只寫「執行了修改」事後看不出變動了什麼
    const changes = [];
    if (fields.zh !== undefined) changes.push(`中文：${brief(target.zh)} → ${brief(zh)}`);
    if (fields.en !== undefined) changes.push(`英文：${brief(target.en)} → ${brief(en)}`);
    await logCommand(
      env,
      interaction,
      '修改人設',
      `「${target.name}」(第${target.id}列) ${changes.join('；')}`,
    );

    await editOriginal(env, interaction.token, {
      embeds: [
        {
          title: `✏️ 「${target.name}」更新完成！`,
          color: 0x57f287,
          fields: [
            { name: `中文提示詞 ${mark('zh')}`, value: after.zh || '（還沒填）' },
            { name: `英文提示詞 ${mark('en')}`, value: after.en || '（還沒填）' },
          ],
          footer: { text: `第 ${target.id} 列　|　分頁：${config.sheetName}` },
        },
      ],
    });
  } catch (error) {
    return say(explain(error, env));
  }
}

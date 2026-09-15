import { deferred, option } from '../lib/respond.js';
import { editOriginal } from '../lib/discord.js';
import { appendRecord, SheetError } from '../lib/sheets.js';
import { loadForWrite, findRecord, clearCache, NotConfiguredError } from '../data/prompts.js';
import { logCommand } from '../data/command-log.js';

function brief(text) {
  const value = String(text ?? '');
  if (!value) return '（還沒填）';
  return value.length > 60 ? `${value.slice(0, 60)}…` : value;
}

const MAX_NAME = 100;
const MAX_PROMPT = 2000;

export const data = {
  name: '新增人設',
  description: '新增一筆人設到這個伺服器的資料庫',
  // 開放給所有成員。要改成只有特定身分組能用，不必改程式 ——
  // 伺服器設定 → 整合 → 小蒜頭 可以逐指令覆寫，而且各伺服器可以不同。
  dm_permission: false,
  options: [
    { type: 3, name: '人設名稱', description: '不可與現有名稱重複', required: true },
    // 兩個提示詞各自選填，但至少要有一個 —— Discord 無法表達
    // 「二選一必填」，所以在程式裡檢查
    { type: 3, name: '中文提示詞', description: '中文版本（與英文至少填一項）', required: false },
    { type: 3, name: '英文提示詞', description: '英文版本（與中文至少填一項）', required: false },
  ],
};

export async function execute(interaction, env, ctx) {
  ctx.waitUntil(run(interaction, env));
  return deferred({ ephemeral: true });
}

async function run(interaction, env) {
  const say = (content) => editOriginal(env, interaction.token, { content }).catch(() => {});

  const name = String(option(interaction, '人設名稱', '')).trim();
  const zh = String(option(interaction, '中文提示詞', '') ?? '').trim();
  const en = String(option(interaction, '英文提示詞', '') ?? '').trim();

  if (!name) return say('人設名稱不能空白喔 📝');
  if (!zh && !en) return say('中文和英文至少要填一個喔！');
  if (name.length > MAX_NAME) return say(`名字太長啦，上限 ${MAX_NAME} 字 ✂️`);
  if (zh.length > MAX_PROMPT) return say(`中文提示詞太長啦，上限 ${MAX_PROMPT} 字 ✂️`);
  if (en.length > MAX_PROMPT) return say(`英文提示詞太長啦，上限 ${MAX_PROMPT} 字 ✂️`);

  try {
    // 一定要讀最新資料 —— 用過期快取判斷重複會漏掉別人剛剛新增的名稱
    const { records, cols, config } = await loadForWrite(env, interaction.guild_id);

    const existing = findRecord(records, name);
    if (existing) {
      // 被擋下來也記一筆：事後才看得出有人嘗試過、以及為什麼沒成功
      await logCommand(env, interaction, '新增人設', `「${name}」名稱重複，未寫入`);
      return editOriginal(env, interaction.token, {
        embeds: [
          {
            title: `⚠️ 「${existing.name}」已經在庫裡囉`,
            description: '這次沒有動到任何資料。想改內容的話用 `/修改人設` ✏️',
            color: 0xfaa61a,
            fields: [
              { name: '中文提示詞', value: existing.zh || '（還沒填）' },
              { name: '英文提示詞', value: existing.en || '（還沒填）' },
            ],
            footer: { text: `它住在第 ${existing.id} 列` },
          },
        ],
      }).catch(() => {});
    }

    // 記下建立者，/刪除人設 靠它判斷誰有權刪除
    const author = interaction.member?.user?.id ?? '';
    const row = await appendRecord(env, config, cols, { name, zh, en, author });
    await clearCache(env, interaction.guild_id);

    await logCommand(
      env,
      interaction,
      '新增人設',
      `「${name}」${row ? `(第${row}列)` : ''} 中文：${brief(zh)}；英文：${brief(en)}`,
    );

    await editOriginal(env, interaction.token, {
      embeds: [
        {
          title: `🌱 「${name}」入庫完成！`,
          color: 0x57f287,
          fields: [
            { name: '中文提示詞', value: zh || '（還沒填）' },
            { name: '英文提示詞', value: en || '（還沒填）' },
          ],
          footer: { text: row ? `住進第 ${row} 列　|　分頁：${config.sheetName}` : `分頁：${config.sheetName}` },
        },
      ],
    });
  } catch (error) {
    return say(explain(error, env));
  }
}

export function explain(error, env) {
  if (error instanceof NotConfiguredError) {
    return '這裡還沒有資料庫！請伺服器管理員跑一次 `/設定資料庫` 就能開始用 ✨';
  }
  if (error instanceof SheetError) {
    if (error.kind === 'forbidden') {
      return `❌ 機器人沒有試算表的寫入權限。請確認 \`${env.GOOGLE_SA_EMAIL}\` 的分享權限是「編輯者」。`;
    }
    if (error.kind === 'bad_headers') {
      return [
        `❌ ${error.message}`,
        '',
        '分頁第一列需要「人設名稱」欄，以及「中文提示詞」或「英文提示詞」至少一欄。',
      ].join('\n');
    }
    return `❌ 操作失敗：${error.message}`;
  }
  console.error('人設寫入失敗：', error);
  return '❌ 出了點狀況，等一下再試試 🙏';
}

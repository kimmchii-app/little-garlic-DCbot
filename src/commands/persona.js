import { deferred, option, focusedOption, autocompleteChoices } from '../lib/respond.js';
import { editOriginal } from '../lib/discord.js';
import { findByName, suggestNames, NotConfiguredError } from '../data/prompts.js';
import { SheetError } from '../lib/sheets.js';
import { logCommand } from '../data/command-log.js';

// 訊息本文上限 2000 字元，中英文可能同時顯示，各留一半再扣掉標題與標記
const MAX_SHOW = 800;

export const data = {
  name: '人設',
  description: '查出某個人設的提示詞',
  dm_permission: false,
  options: [
    {
      type: 3, // STRING
      name: '人設名稱',
      description: '開始打字會列出可選的名稱',
      required: true,
      autocomplete: true,
    },
    {
      type: 3,
      name: '語體',
      // 不設 required：多數時候兩種都想看，指定時才只看一種
      description: '只看中文或只看英文，不選則兩種都顯示',
      required: false,
      choices: [
        { name: '中文', value: 'zh' },
        { name: '英文', value: 'en' },
      ],
    },
  ],
};

export async function execute(interaction, env, ctx) {
  ctx.waitUntil(run(interaction, env));
  // 不加 ephemeral：結果要讓群裡所有人都看得到
  return deferred();
}

/**
 * 自動完成。這裡沒有 defer 可用，Discord 要求 3 秒內回應，
 * 所以資料一律走快取（可接受過期），絕不為了新鮮度去等 Google。
 * 出錯時回空清單 —— 讓輸入框沒有建議，總比整個互動壞掉好。
 */
export async function autocomplete(interaction, env) {
  try {
    const { value } = focusedOption(interaction);
    return autocompleteChoices(await suggestNames(env, interaction.guild_id, value));
  } catch (error) {
    console.warn('人設自動完成失敗：', error);
    return autocompleteChoices([]);
  }
}

function truncate(text) {
  return text.length > MAX_SHOW ? `${text.slice(0, MAX_SHOW)}…（已截斷）` : text;
}

/**
 * 行內程式碼。
 *
 * 用行內程式碼而不是程式碼區塊，是因為 Discord 手機版只有行內程式碼
 * 可以點一下複製。提示詞的用途就是複製貼上，這顆按鈕是重點。
 * 同理內容要放在訊息本文而不是 embed —— embed 裡的一樣沒有複製功能。
 */
function inlineCode(text) {
  // 行內程式碼不能跨行，換行一律收成空格。
  // 提示詞是逗號分隔的敘述，這樣收攏不影響語意。
  const flat = truncate(text).replace(/\s*\n\s*/g, ' ').trim();

  // 內容若含反引號，分隔符要比它更長，否則程式碼區段會被提前截斷
  const longest = (flat.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(longest + 1);
  const pad = longest > 0 ? ' ' : '';

  return `${fence}${pad}${flat}${pad}${fence}`;
}

async function run(interaction, env) {
  const name = String(option(interaction, '人設名稱', '')).trim();
  const lang = option(interaction, '語體');
  const say = (content) => editOriginal(env, interaction.token, { content }).catch(() => {});

  if (!name) return say('要查誰呢？請輸入人設名稱 👀');

  try {
    const { record, near, stale } = await findByName(env, interaction.guild_id, name);

    const langLabel = lang === 'zh' ? '中文' : lang === 'en' ? '英文' : '中英文';
    await logCommand(
      env,
      interaction,
      '人設',
      `查詢「${name}」語體：${langLabel}${record ? '' : '（查無此人設）'}`,
    );

    if (!record) {
      if (near.length > 0) {
        return say([`沒有完全叫「${name}」的耶，你是不是想找這些？`, ...near.map((r) => `• ${r.name}`)].join('\n'));
      }
      return say(`翻遍了都沒看到「${name}」🔍 名字有打對嗎？`);
    }

    // 指定了語體但那一欄是空的：直接說明，並把有值的另一種拿出來，
    // 比單純回「沒有資料」有用
    if (lang && !record[lang]) {
      const other = lang === 'zh' ? 'en' : 'zh';
      const otherLabel = lang === 'zh' ? '英文' : '中文';
      const wantedLabel = lang === 'zh' ? '中文' : '英文';

      if (!record[other]) {
        return say(`「${record.name}」中英文都還是空的，等人來補 ✍️`);
      }
      return say(
        [
          `**#${record.id} ${record.name}**`,
          `-# 沒有${wantedLabel}提示詞，先給你${otherLabel}版本`,
          inlineCode(record[other]),
        ].join('\n'),
      );
    }

    const lines = [`**#${record.id} ${record.name}**`];
    if (!lang || lang === 'zh') {
      lines.push('中文提示詞', record.zh ? inlineCode(record.zh) : '-# （還沒填）');
    }
    if (!lang || lang === 'en') {
      lines.push('英文提示詞', record.en ? inlineCode(record.en) : '-# （還沒填）');
    }
    if (stale) {
      lines.push('-# ⚠️ 暫時讀不到試算表，這是先前存下來的內容');
    }

    await editOriginal(env, interaction.token, {
      content: lines.join('\n'),
    });
  } catch (error) {
    if (error instanceof NotConfiguredError) {
      return say('這裡還沒有資料庫！請伺服器管理員跑一次 `/設定資料庫` 就能開始用 ✨');
    }
    if (error instanceof SheetError) {
      return say(`讀不到試算表：${error.message}`);
    }
    console.error('查詢人設失敗：', error);
    return say('查詢出了點狀況，等一下再試試 🙏');
  }
}

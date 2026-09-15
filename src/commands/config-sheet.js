import { deferred, option } from '../lib/respond.js';
import { editOriginal, fetchAppOwnerIds } from '../lib/discord.js';
import {
  extractSpreadsheetId,
  isValidSheetName,
  isValidCellRange,
  fetchMetadata,
  fetchRecords,
  createSheetTab,
  bindSheetToGuild,
  DEFAULT_HEADERS,
  SheetError,
} from '../lib/sheets.js';
import {
  setGuildConfig,
  getGuildConfig,
  isSheetClaimedByOthers,
} from '../data/guild-config.js';
import { clearCache } from '../data/prompts.js';
import { logCommand } from '../data/command-log.js';

const MANAGE_GUILD = 1 << 5;

export const data = {
  name: '設定資料庫',
  description: '建立這個伺服器專屬的人設分頁',
  default_member_permissions: String(MANAGE_GUILD),
  dm_permission: false,
  options: [
    {
      type: 3, // STRING
      name: '群組名稱',
      // 每個伺服器對應各自的分頁，所以不給預設值 —— 省略的話很容易
      // 不小心把新伺服器接到別的伺服器的資料上
      description: '這個伺服器要用的分頁名稱，通常就是群組名稱',
      required: true,
    },
    {
      type: 5, // BOOLEAN
      name: '自動建立',
      // 預設 true：進新群組時本來就還沒有分頁，這才是常態。
      // 名稱打錯的話，回覆會明確寫「已建立分頁」而不是「設定完成」，
      // 多出來的空白分頁在試算表裡刪掉即可。
      description: '分頁不存在時自動建立並填好標題列（預設開啟）',
      required: false,
    },
    {
      type: 3,
      name: '範圍',
      description: '儲存格範圍如 A1:C500，不填則讀整個分頁',
      required: false,
    },
  ],
};

export async function execute(interaction, env, ctx) {
  // 這裡會實際連線 Google 試讀一次，必定超過 3 秒限制
  ctx.waitUntil(run(interaction, env));
  return deferred({ ephemeral: true });
}

async function run(interaction, env) {
  const sheetName = option(interaction, '群組名稱');
  // 明確設 False 時會拿到 false，?? 只在沒給值時才落到預設的 true
  const wantCreate = option(interaction, '自動建立', true);
  const cellRangeInput = option(interaction, '範圍');
  const userId = interaction.member?.user?.id ?? '';

  const say = (content) => editOriginal(env, interaction.token, { content }).catch(() => {});

  // 擁有者看得到完整的分頁清單（他本來就擁有整張試算表），
  // 其他伺服器的管理員不行 —— 那會洩漏別人用的分頁名稱
  const isOwner = await fetchAppOwnerIds(env)
    .then((owners) => owners.has(userId))
    .catch(() => false);

  // --- 試算表是固定的那一張 ---
  const spreadsheetId = extractSpreadsheetId(env.PROMPT_SPREADSHEET_ID);
  if (!spreadsheetId) {
    return say('❌ 尚未設定 `PROMPT_SPREADSHEET_ID`，請檢查 wrangler.jsonc。');
  }

  // --- 驗證輸入 ---
  if (!isValidSheetName(sheetName)) {
    return say('分頁名稱不正確。');
  }
  if (cellRangeInput && !isValidCellRange(cellRangeInput)) {
    return say('範圍格式不正確，應該像 `A1:C500` 這樣。');
  }

  try {
    // 所有伺服器共用同一張試算表，所以分頁被別人佔用就不能再指過去，
    // 否則等於可以讀寫別的伺服器的資料
    if (await isSheetClaimedByOthers(env, sheetName, interaction.guild_id)) {
      return say(`分頁「${sheetName}」已經被其他伺服器使用了，請換一個名稱。`);
    }

    // 先記下原本指向哪裡，改動後要明確告訴使用者前後差異 ——
    // 舊分頁的資料不會消失，但從此讀不到，這件事必須講清楚
    const previous = await getGuildConfig(env, interaction.guild_id);

    const meta = await fetchMetadata(env, spreadsheetId);
    const existingSheet = meta.sheets.find((s) => s.title === sheetName);
    const exists = Boolean(existingSheet);
    let created = false;

    // 分頁本身記著自己屬於哪個伺服器。這道檢查比 D1 的登記更可靠 ——
    // 即使 D1 的資料遺失或被還原到舊版本，綁定關係仍然在試算表上。
    if (existingSheet?.guildId && existingSheet.guildId !== interaction.guild_id) {
      return say(`分頁「${sheetName}」屬於其他伺服器，請換一個名稱。`);
    }

    // 非擁有者只能建立新分頁，不能接上任何既有分頁 ——
    // 否則可以靠反覆嘗試名稱來探測、進而讀取別人的資料。
    // 例外是自己目前已經在用的那一個，重跑指令應該要成功。
    if (exists && !isOwner && previous?.sheetName !== sheetName) {
      return say(`分頁「${sheetName}」已經存在，請換一個名稱。`);
    }

    if (!exists) {
      if (!wantCreate) {
        return say(
          [
            `找不到分頁「${sheetName}」，而你把 \`自動建立\` 關掉了。`,
            // 分頁清單只給擁有者看，對其他伺服器的管理員揭露等於洩漏別人的資料位置
            ...(isOwner
              ? ['', `目前的分頁：${meta.sheetNames.map((n) => `\`${n}\``).join('、')}`]
              : []),
          ].join('\n'),
        );
      }
      await createSheetTab(env, spreadsheetId, sheetName);
      created = true;
    }

    // --- 試讀一次 ---
    // 設定錯了要當場知道，而不是等別人打 /人設 才發現
    const config = { spreadsheetId, sheetName, cellRange: cellRangeInput || null };
    const { records, headers } = await fetchRecords(env, config);

    // 把歸屬寫進分頁本身。新建的分頁沒有綁定，先前建立的舊分頁也會在這裡補上。
    const sheet = created
      ? (await fetchMetadata(env, spreadsheetId)).sheets.find((s) => s.title === sheetName)
      : existingSheet;
    if (sheet) {
      await bindSheetToGuild(env, spreadsheetId, sheet, interaction.guild_id);
    }

    await setGuildConfig(env, interaction.guild_id, { ...config, updatedBy: userId });
    await clearCache(env, interaction.guild_id);

    const switched = previous && previous.sheetName !== sheetName;

    await logCommand(
      env,
      interaction,
      '設定資料庫',
      switched
        ? `分頁：${previous.sheetName} → ${sheetName}${created ? '（新建立）' : ''}`
        : `分頁：${sheetName}${created ? '（新建立）' : ''}${previous ? '（未變更）' : ''}`,
    );

    const fields = [
      { name: '試算表', value: meta.title || spreadsheetId },
      {
        name: '這個伺服器使用的分頁',
        value:
          `\`${sheetName}\`${cellRangeInput ? ` 範圍 \`${cellRangeInput}\`` : '（整個分頁）'}` +
          (created ? `\n已自動填入標題列：${DEFAULT_HEADERS.join('、')}` : ''),
      },
      { name: '讀到資料', value: `${records.length} 筆` },
      { name: '偵測到的欄位', value: headers.map((h) => `\`${h}\``).join('、') || '（無）' },
    ];

    if (switched) {
      fields.unshift({
        name: '⚠️ 已切換分頁',
        value:
          `原本：\`${previous.sheetName}\` → 現在：\`${sheetName}\`\n` +
          `\`${previous.sheetName}\` 的資料還在試算表裡，但這個伺服器從現在起讀不到它。`,
      });
    }

    await editOriginal(env, interaction.token, {
      embeds: [
        {
          title: created
            ? '🆕 新分頁建好囉！'
            : switched
              ? '🔀 已切換到其他分頁'
              : '✅ 資料庫設定完成！',
          color: switched ? 0xfaa61a : 0x57f287,
          fields,
          footer: {
            text: created
              ? '分頁還是空的，用 /新增人設 開始加內容吧 ✨'
              : '目前狀態隨時可用 /資料庫資訊 查看',
          },
        },
      ],
    });
  } catch (error) {
    return say(explain(error, env));
  }
}

function explain(error, env) {
  if (error instanceof SheetError) {
    switch (error.kind) {
      case 'forbidden':
        return [
          '❌ 機器人存取不了資料庫試算表。',
          '',
          '請在試算表右上角按「共用」，把下面這個 email 加為**編輯者**：',
          '```',
          env.GOOGLE_SA_EMAIL,
          '```',
          '（必須是編輯者 —— 這個指令要建立分頁並寫入歸屬記錄，「檢視者」做不到。）',
          '它不是真人帳號，不會收到通知信，加完直接重跑這個指令即可。',
        ].join('\n');
      case 'not_found':
        return '❌ 找不到資料庫試算表，請確認 `PROMPT_SPREADSHEET_ID` 正確、而且檔案沒有被刪除。';
      case 'bad_range':
        return '❌ 分頁名稱或範圍不正確，請確認後重試。';
      case 'bad_headers':
        return [
          `❌ ${error.message}`,
          '',
          '第一列必須是標題列，需要「人設名稱」欄，以及「中文提示詞」或「英文提示詞」至少一欄。',
          '「建立者」欄選填，但修改和刪除功能需要它。',
        ].join('\n');
      case 'empty':
        return '❌ 這個分頁讀不到資料，請先填入內容再設定。';
      default:
        return `❌ 讀取失敗：${error.message}`;
    }
  }
  console.error('設定資料庫失敗：', error);
  return '❌ 設定出了點狀況，等一下再試試 🙏';
}

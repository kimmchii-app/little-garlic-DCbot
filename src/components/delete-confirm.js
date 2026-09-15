import { updateMessage } from '../lib/respond.js';
import { deleteRow, fetchMetadata, SheetError } from '../lib/sheets.js';
import { loadForWrite, findRecord, clearCache } from '../data/prompts.js';
import { consumePendingDelete } from '../data/pending-delete.js';
import { logCommand } from '../data/command-log.js';

export const prefix = 'delok';

/** 覆蓋原訊息並移除按鈕，避免同一顆鈕被重複點擊 */
function done(content) {
  return updateMessage({ content, components: [] });
}

export async function execute(interaction, env) {
  const token = interaction.data.custom_id.slice(prefix.length + 1);
  const clickerId = interaction.member?.user?.id ?? '';

  // 一次性取用，重複點擊第二次就會拿不到
  const pending = await consumePendingDelete(env, token);

  if (!pending) return done('這個確認已經用過或失效囉');
  if (pending.expired) return done('確認逾時了，重新跑一次 `/刪除人設` 吧');

  // 按鈕是誰都點得到的，所以權限要在這裡再驗一次，不能只靠下指令時的檢查
  if (pending.userId !== clickerId) {
    return done('這不是你發起的刪除喔');
  }

  try {
    // 重新讀取：從按下指令到按下確認之間，資料可能已經被改動，
    // 列號也可能因為別人刪除而位移。不能沿用先前的快照。
    const { records, cols, config } = await loadForWrite(env, pending.guildId);
    const target = findRecord(records, pending.name);

    if (!target) return done(`「${pending.name}」已經不在了`);
    if (cols.author < 0 || !target.author) {
      return done(`「${target.name}」現在沒有建立者資訊，無法刪除。`);
    }
    if (target.author !== clickerId) {
      return done(`「${target.name}」現在的建立者不是你，已取消刪除。`);
    }

    const meta = await fetchMetadata(env, config.spreadsheetId);
    const sheet = meta.sheets.find((s) => s.title === config.sheetName);
    if (!sheet) return done('找不到對應的分頁，已取消刪除。');

    await deleteRow(env, config.spreadsheetId, sheet.sheetId, target.id);
    await clearCache(env, pending.guildId);

    await logCommand(
      env,
      interaction,
      '刪除人設',
      `「${target.name}」(原第${target.id}列) 中文：${target.zh || '（還沒填）'}；英文：${target.en || '（還沒填）'}`,
    );

    return done(`🧹 「${target.name}」已經刪掉囉，掰掰～`);
  } catch (error) {
    if (error instanceof SheetError) {
      return done(`❌ 刪除失敗：${error.message}`);
    }
    console.error('確認刪除失敗：', error);
    return done('❌ 刪除失敗，等一下再試試 🙏');
  }
}

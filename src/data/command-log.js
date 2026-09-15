// 指令使用紀錄。
//
// 原則：寫紀錄失敗絕對不能讓指令本身失敗。使用者要的是指令成功，
// 少一筆稽核紀錄是可以接受的損失，反過來則不行。
import { rest } from '../lib/discord.js';

// 群組名稱不常變，但也不該永遠不更新
const NAME_TTL = 7 * 24 * 3600;

function now() {
  return Math.floor(Date.now() / 1000);
}

/**
 * 取得群組名稱。互動事件的內容不含群組名稱，所以要向 Discord 查，
 * 查到就快取起來，避免每寫一筆紀錄都打一次 API。
 */
async function resolveGuildName(env, guildId) {
  try {
    const row = await env.DB.prepare(
      `SELECT name, updated_at FROM guild_names WHERE guild_id = ?1`,
    )
      .bind(guildId)
      .first();

    if (row && row.updated_at > now() - NAME_TTL) return row.name;

    const guild = await rest(env, 'GET', `/guilds/${guildId}`);
    const name = guild?.name ?? '';

    if (name) {
      await env.DB.prepare(
        `INSERT INTO guild_names (guild_id, name, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(guild_id) DO UPDATE SET name = ?2, updated_at = ?3`,
      )
        .bind(guildId, name, now())
        .run();
      return name;
    }

    // 查不到新的就沿用舊的，總比留空好
    return row?.name ?? '';
  } catch (error) {
    console.warn('取得群組名稱失敗：', error);
    return '';
  }
}

/** 從互動事件取出使用者的顯示名稱 */
function userLabel(interaction) {
  const user = interaction.member?.user ?? interaction.user;
  if (!user) return { id: '', name: '' };
  return { id: user.id ?? '', name: user.global_name || user.username || '' };
}

/**
 * 寫一筆指令使用紀錄。
 *
 * @param detail 這次做了什麼。修改類的指令應該寫成「改前 → 改後」，
 *   紀錄的價值在於事後看得出變動了什麼，只寫「執行了修改」沒有用。
 */
export async function logCommand(env, interaction, command, detail = '') {
  try {
    const guildId = interaction.guild_id ?? '';
    const { id, name } = userLabel(interaction);
    const guildName = guildId ? await resolveGuildName(env, guildId) : '';

    await env.DB.prepare(
      `INSERT INTO command_log (guild_id, guild_name, user_id, user_name, command, detail, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
      .bind(guildId, guildName, id, name, command, String(detail).slice(0, 1000), now())
      .run();
  } catch (error) {
    console.warn('寫入指令紀錄失敗（不影響指令本身）：', error);
  }
}

/** 紀錄保留天數。超過就由每日排程刪除。 */
export const RETENTION_DAYS = 30;

/**
 * 刪除超過保留期限的紀錄。由 Cron Trigger 每天呼叫。
 *
 * 跨所有伺服器一起清 —— 保留期限是全域規則，不是各伺服器自訂的。
 */
export async function purgeOldLogs(env, days = RETENTION_DAYS) {
  const cutoff = now() - days * 24 * 3600;
  const result = await env.DB.prepare(`DELETE FROM command_log WHERE created_at < ?1`)
    .bind(cutoff)
    .run();

  return { deleted: result.meta?.changes ?? 0, cutoff };
}

/** 取這個伺服器最近的紀錄 */
export async function recentLogs(env, guildId, { limit = 10, command = null } = {}) {
  const sql = command
    ? `SELECT * FROM command_log WHERE guild_id = ?1 AND command = ?3
       ORDER BY created_at DESC, id DESC LIMIT ?2`
    : `SELECT * FROM command_log WHERE guild_id = ?1
       ORDER BY created_at DESC, id DESC LIMIT ?2`;

  const stmt = command
    ? env.DB.prepare(sql).bind(guildId, limit, command)
    : env.DB.prepare(sql).bind(guildId, limit);

  const { results } = await stmt.all();
  return results ?? [];
}

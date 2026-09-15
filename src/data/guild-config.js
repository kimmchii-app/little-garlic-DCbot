// 每個 Discord 伺服器的資料庫設定（存在 D1）。

export async function getGuildConfig(env, guildId) {
  const row = await env.DB.prepare(
    `SELECT spreadsheet_id, sheet_name, cell_range, updated_at, updated_by
     FROM guild_config WHERE guild_id = ?1`,
  )
    .bind(guildId)
    .first();

  if (!row) return null;

  return {
    spreadsheetId: row.spreadsheet_id,
    sheetName: row.sheet_name,
    // 空字串代表「整個分頁」，傳給 sheets.js 時要是 falsy
    cellRange: row.cell_range || null,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

/**
 * 這個分頁是否已被「其他」伺服器佔用。
 *
 * 所有伺服器共用同一張試算表，所以分頁名稱就是唯一的識別。
 * 少了這道檢查，任何伺服器的管理員只要知道別人的分頁名稱，
 * 就能把自己的伺服器指過去，讀寫別人的資料。
 *
 * 只回傳有沒有被佔用，不回傳是哪個伺服器 —— 那是不必要的揭露。
 */
export async function isSheetClaimedByOthers(env, sheetName, selfGuildId) {
  const row = await env.DB.prepare(
    `SELECT 1 AS taken FROM guild_config WHERE sheet_name = ?1 AND guild_id != ?2 LIMIT 1`,
  )
    .bind(sheetName, selfGuildId)
    .first();
  return Boolean(row);
}

export async function setGuildConfig(env, guildId, { spreadsheetId, sheetName, cellRange, updatedBy }) {
  await env.DB.prepare(
    `INSERT INTO guild_config (guild_id, spreadsheet_id, sheet_name, cell_range, updated_at, updated_by)
     VALUES (?1, ?2, ?3, ?4, unixepoch(), ?5)
     ON CONFLICT(guild_id) DO UPDATE SET
       spreadsheet_id = ?2,
       sheet_name     = ?3,
       cell_range     = ?4,
       updated_at     = unixepoch(),
       updated_by     = ?5`,
  )
    .bind(guildId, spreadsheetId, sheetName, cellRange ?? '', updatedBy ?? '')
    .run();
}

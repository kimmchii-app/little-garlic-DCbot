// 人設資料的存取層。
//
// 來源是每個伺服器各自設定的 Google 試算表分頁（見 src/lib/sheets.js），
// 中間隔一層 D1 快取，避免每次指令都打 Google API。
//
// 讀取順序：快取（未過期）→ 試算表 → 失敗時退回過期快取
import { fetchRecords, fetchMetadata, SheetError } from '../lib/sheets.js';
import { getGuildConfig } from './guild-config.js';

const CACHE_TTL = 300; // 秒。改完試算表最多等這麼久，或用 /重新整理資料庫

/** 這個伺服器還沒跑過 /設定資料庫 */
export class NotConfiguredError extends Error {}

/**
 * 讀取前先確認這個分頁確實屬於這個伺服器。
 *
 * D1 的設定存的是分頁「名稱」，而名稱是可以被改的。
 * 如果有人把分頁改名、另一個分頁又剛好叫了原本的名字，
 * 光靠名稱就會讀到別人的資料。分頁上的隱藏綁定才是可靠的依據。
 *
 * 成本是每次快取未命中多一次 API 呼叫 —— 每個伺服器最多五分鐘一次，可以接受。
 */
async function fetchVerified(env, config, guildId) {
  const meta = await fetchMetadata(env, config.spreadsheetId);
  const sheet = meta.sheets.find((s) => s.title === config.sheetName);

  if (!sheet) {
    throw new SheetError(
      'not_found',
      `找不到分頁「${config.sheetName}」，可能已被改名或刪除`,
    );
  }
  // guildId 為空的是綁定機制啟用前建立的分頁，沿用舊行為不擋
  if (sheet.guildId && sheet.guildId !== guildId) {
    throw new SheetError('wrong_guild', `分頁「${config.sheetName}」屬於其他伺服器`);
  }

  return fetchRecords(env, config);
}

function now() {
  return Math.floor(Date.now() / 1000);
}

async function readCache(env, guildId) {
  const row = await env.DB.prepare(
    `SELECT payload, fetched_at, expires_at FROM sheet_cache WHERE guild_id = ?1`,
  )
    .bind(guildId)
    .first();

  if (!row) return null;

  try {
    const parsed = JSON.parse(row.payload);
    // 舊版快取存的是陣列，新版存 { records, cols }。格式不符就當作沒有快取。
    if (!parsed || !Array.isArray(parsed.records)) return null;
    return { ...parsed, fetchedAt: row.fetched_at, stale: row.expires_at <= now() };
  } catch {
    return null;
  }
}

async function writeCache(env, guildId, payload) {
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO sheet_cache (guild_id, payload, fetched_at, expires_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(guild_id) DO UPDATE SET payload = ?2, fetched_at = ?3, expires_at = ?4`,
  )
    .bind(guildId, JSON.stringify(payload), ts, ts + CACHE_TTL)
    .run();
}

export async function clearCache(env, guildId) {
  await env.DB.prepare(`DELETE FROM sheet_cache WHERE guild_id = ?1`).bind(guildId).run();
}

/**
 * 取得這個伺服器的全部人設。
 *
 * @param options.allowStale 有快取就用，不管過期 —— 給自動完成用，
 *   它沒有 defer 可用，必須 3 秒內回應，不能為了新鮮度去等 Google。
 * @param options.fresh 略過快取直接讀試算表 —— 給寫入前的檢查用，
 *   拿過期資料判斷「名稱重不重複」會誤判。
 *
 * 回傳的 stale 為 true 代表這是抓不到試算表時退回的過期資料。
 */
export async function loadPrompts(env, guildId, { allowStale = false, fresh = false } = {}) {
  const cached = fresh ? null : await readCache(env, guildId);

  if (cached && !cached.stale) {
    return { ...cached, stale: false };
  }
  if (cached && allowStale) {
    return { ...cached, stale: true };
  }

  const config = await getGuildConfig(env, guildId);
  if (!config) throw new NotConfiguredError();

  try {
    const { records, cols } = await fetchVerified(env, config, guildId);
    const payload = { records, cols };
    await writeCache(env, guildId, payload);
    return { ...payload, config, stale: false, fetchedAt: now() };
  } catch (error) {
    // 抓不到就用過期快取頂著，總比整個功能掛掉好
    if (cached) {
      console.warn('試算表讀取失敗，退回過期快取：', error);
      return { ...cached, stale: true };
    }
    throw error;
  }
}

/**
 * 寫入前用的讀取：一定是最新資料，而且連同設定與欄位位置一起回傳。
 * 判斷名稱是否重複、定位要改哪一列都需要這些。
 */
export async function loadForWrite(env, guildId) {
  const config = await getGuildConfig(env, guildId);
  if (!config) throw new NotConfiguredError();
  const { records, cols } = await fetchVerified(env, config, guildId);
  return { records, cols, config };
}

function normalize(text) {
  return String(text ?? '').trim().toLowerCase();
}

/** 依名稱精確查找（忽略大小寫與前後空白） */
export function findRecord(records, name) {
  const wanted = normalize(name);
  return records.find((r) => normalize(r.name) === wanted) ?? null;
}

/** 依名稱查找，找不到時附上幾筆相近的 */
export async function findByName(env, guildId, name) {
  const { records, stale } = await loadPrompts(env, guildId);
  const exact = findRecord(records, name);
  if (exact) return { record: exact, near: [], stale };

  const wanted = normalize(name);
  const near = records.filter((r) => normalize(r.name).includes(wanted)).slice(0, 5);
  return { record: null, near, stale };
}

/** 自動完成用：依已輸入的字過濾名稱 */
export async function suggestNames(env, guildId, typed, limit = 25) {
  const { records } = await loadPrompts(env, guildId, { allowStale: true });
  const q = normalize(typed);

  const pool = records.filter((r) => r.name);
  const matched = q ? pool.filter((r) => normalize(r.name).includes(q)) : pool;

  // Discord 限制 name 與 value 各 100 字元
  return matched.slice(0, limit).map((r) => ({
    name: r.name.slice(0, 100),
    value: r.name.slice(0, 100),
  }));
}

export { SheetError };

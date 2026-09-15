-- 提示詞題庫
CREATE TABLE IF NOT EXISTS prompts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  tags       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_prompts_title ON prompts(title);
CREATE INDEX IF NOT EXISTS idx_prompts_tags  ON prompts(tags);

-- 每個 Discord 伺服器各自的題庫設定。
-- 多租戶的核心：A 伺服器接自己的試算表，B 伺服器接 B 的。
CREATE TABLE IF NOT EXISTS guild_config (
  guild_id       TEXT PRIMARY KEY,
  spreadsheet_id TEXT NOT NULL,
  sheet_name     TEXT NOT NULL,
  cell_range     TEXT NOT NULL DEFAULT '',
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_by     TEXT NOT NULL DEFAULT ''
);

-- 試算表內容快取，避免每次指令都打 Google。
-- 過期的列不會立刻刪除：Sheets 暫時抓不到時可以退回用過期資料，
-- 總比整個功能掛掉好。
CREATE TABLE IF NOT EXISTS sheet_cache (
  guild_id   TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- 指令使用紀錄。
-- guild_name 與 user_name 是寫入當下的快照，不是即時關聯 ——
-- 群組或使用者日後改名，紀錄仍應呈現當時的樣子。
CREATE TABLE IF NOT EXISTS command_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  guild_name TEXT NOT NULL DEFAULT '',
  user_id    TEXT NOT NULL DEFAULT '',
  user_name  TEXT NOT NULL DEFAULT '',
  command    TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_log_guild_time ON command_log(guild_id, created_at DESC);

-- 群組名稱快取。互動事件本身不帶群組名稱，
-- 每寫一筆紀錄就去問一次 Discord 太浪費，所以查過就存起來。
CREATE TABLE IF NOT EXISTS guild_names (
  guild_id   TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 等待二次確認的刪除請求。
--
-- 不把人設名稱直接塞進按鈕的 custom_id，是因為那有 100 字元上限，
-- 而人設名稱本身就可能到 100 字元。改用短 token 對應，順便能設定過期時間。
CREATE TABLE IF NOT EXISTS pending_deletes (
  token      TEXT PRIMARY KEY,
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Google access token 快取。
-- token 綁 Service Account 而非綁 Discord 伺服器，所以全域只有一列（id 固定 'google'）。
CREATE TABLE IF NOT EXISTS token_cache (
  id           TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  expires_at   INTEGER NOT NULL
);

-- 幾筆範例資料，方便馬上驗證指令有沒有通。
-- 指定固定 id 並用 OR IGNORE，讓整份 schema.sql 可以重複執行而不會插出重複列。
INSERT OR IGNORE INTO prompts (id, title, content, tags) VALUES
  (1, '賽博龐克街景', 'cyberpunk street, neon signs, rain reflections, night, cinematic lighting', '場景,科幻'),
  (2, '水彩肖像',     'watercolor portrait, soft edges, pastel palette, paper texture', '人物,插畫'),
  (3, '等距小房間',   'isometric cozy room, warm lighting, detailed props, 3d render', '場景,3D');

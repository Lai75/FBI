const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'liaohuiyi.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  source TEXT,
  timezone TEXT DEFAULT 'local',
  status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  sent_at TEXT,
  sender TEXT,
  content TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0,
  needs_review INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_messages_import ON messages(import_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages(sent_at);
`);

// FTS5 全文检索能力探测；不支持则后续查询退化为 LIKE
let ftsAvailable = true;
try {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content, sender, content='messages', content_rowid='id', tokenize='unicode61'
    );
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content, sender) VALUES (new.id, new.content, new.sender);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content, sender) VALUES('delete', old.id, old.content, old.sender);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content, sender) VALUES('delete', old.id, old.content, old.sender);
      INSERT INTO messages_fts(rowid, content, sender) VALUES (new.id, new.content, new.sender);
    END;
  `);
} catch (err) {
  ftsAvailable = false;
  console.warn('[db] FTS5 不可用，检索将退化为 LIKE 匹配：', err.message);
}

module.exports = { db, ftsAvailable };

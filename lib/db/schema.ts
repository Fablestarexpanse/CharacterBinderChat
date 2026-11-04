// ─── Drawer 2 SQLite Schema ───────────────────────────────────────────────────
// Derived from fable_drawer2/schema.py, extended with chat scoping.
//
// MEMORY IS SCOPED TO A CHAT, NOT A CHARACTER. Each chat is its own story with
// its own timeline: starting a new chat with the same character starts from a
// blank slate. Carrying memories forward is an explicit transfer, never an
// implicit share. (Schema v2 — v1 was character-global; FableStore migrates.)
//
// NOTE: never put a semicolon inside a comment — _initSchema splits on them.

export const CREATE_TABLES_SQL = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS entities (
  chat_id     TEXT    NOT NULL,
  id          TEXT    NOT NULL,
  type        TEXT    NOT NULL CHECK(type IN ('character','place','object','faction','concept')),
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (chat_id, id)
);

CREATE TABLE IF NOT EXISTS facts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id        TEXT    NOT NULL,
  subject_id     TEXT    NOT NULL,
  predicate      TEXT    NOT NULL,
  object_id      TEXT,
  object_literal TEXT,
  t_valid_start  INTEGER NOT NULL,
  t_valid_end    INTEGER,
  t_ingested     INTEGER NOT NULL,
  confidence     REAL    NOT NULL DEFAULT 1.0 CHECK(confidence >= 0.0 AND confidence <= 1.0),
  importance     REAL    NOT NULL DEFAULT 0.5,
  known_to       TEXT    NOT NULL DEFAULT '[]',
  -- L2-normalised float32 vector, nullable. Embeddings are optional and
  -- retrieval falls back to lexical ranking without them
  embedding      BLOB,
  -- User curation. pinned: always injected into the prompt. locked: automatic
  -- extraction may not supersede or overwrite it (a hand edit locks it)
  pinned         INTEGER NOT NULL DEFAULT 0,
  locked         INTEGER NOT NULL DEFAULT 0,
  superseded_by  INTEGER REFERENCES facts(id),
  FOREIGN KEY (chat_id, subject_id) REFERENCES entities(chat_id, id),
  FOREIGN KEY (chat_id, object_id)  REFERENCES entities(chat_id, id)
);

CREATE TABLE IF NOT EXISTS relationship_stats (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id      TEXT    NOT NULL,
  observer_id  TEXT    NOT NULL,
  target_id    TEXT    NOT NULL,
  stat_name    TEXT    NOT NULL CHECK(stat_name IN ('affection','trust','desire','connection','mood')),
  value        REAL    NOT NULL DEFAULT 0.0,
  decay_rate   REAL    NOT NULL,
  -- Countdown set by a large negative hit. While positive, positive deltas on
  -- this stat are dampened so a betrayal is not undone in a few exchanges
  rupture_recovery INTEGER NOT NULL DEFAULT 0,
  last_updated INTEGER NOT NULL,
  UNIQUE(chat_id, observer_id, target_id, stat_name)
);

CREATE TABLE IF NOT EXISTS memory_cards (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id    TEXT    NOT NULL,
  title      TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  tags       TEXT    NOT NULL DEFAULT '[]',
  entity_ids TEXT    NOT NULL DEFAULT '[]',
  importance REAL    NOT NULL DEFAULT 0.5,
  embedding  BLOB,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS commitments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id     TEXT    NOT NULL,
  promisor_id TEXT    NOT NULL,
  promisee_id TEXT,
  description TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','fulfilled','broken','forgotten')),
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(chat_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_facts_valid   ON facts(chat_id, t_valid_start, t_valid_end);
CREATE INDEX IF NOT EXISTS idx_facts_object  ON facts(chat_id, object_id);
CREATE INDEX IF NOT EXISTS idx_stats_pair    ON relationship_stats(chat_id, observer_id, target_id);

-- ─── Drawer 1: Core Memory Block ────────────────────────────────────────────
-- One row per (chat, character) - the "conscious mind" state for that story.

CREATE TABLE IF NOT EXISTS core_memory (
  chat_id      TEXT    NOT NULL,
  character_id TEXT    NOT NULL,
  data         TEXT    NOT NULL DEFAULT '{}',
  version      INTEGER NOT NULL DEFAULT 1,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (chat_id, character_id)
);

-- ─── Memory snapshots ──────────────────────────────────────────────────────
-- Stats and core memory are current-state only, so branching a chat from an
-- earlier message needs a record of what they were then. One row per message
-- whose extraction finished: core memory rows and relationship stats as JSON.
-- Facts, cards and commitments need no snapshot, since they are timestamped.

CREATE TABLE IF NOT EXISTS memory_snapshots (
  chat_id    TEXT    NOT NULL,
  message_id TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  data       TEXT    NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);

-- ─── App State: characters / chats / messages / personas ────────────────────
-- Durable mirror of the client store. Rows hold the full JSON of each object
-- and seq preserves array order. Drawer 2 remains the queryable layer.

CREATE TABLE IF NOT EXISTS app_characters (
  id   TEXT    PRIMARY KEY,
  seq  INTEGER NOT NULL,
  data TEXT    NOT NULL,
  rev  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_chats (
  id   TEXT    PRIMARY KEY,
  seq  INTEGER NOT NULL,
  data TEXT    NOT NULL,
  rev  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_messages (
  id      TEXT    PRIMARY KEY,
  chat_id TEXT    NOT NULL,
  seq     INTEGER NOT NULL,
  data    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS app_personas (
  id   TEXT    PRIMARY KEY,
  seq  INTEGER NOT NULL,
  data TEXT    NOT NULL,
  rev  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_lorebooks (
  id   TEXT    PRIMARY KEY,
  seq  INTEGER NOT NULL,
  data TEXT    NOT NULL,
  rev  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_scenarios (
  id   TEXT    PRIMARY KEY,
  seq  INTEGER NOT NULL,
  data TEXT    NOT NULL,
  rev  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_presets (
  id   TEXT    PRIMARY KEY,
  seq  INTEGER NOT NULL,
  data TEXT    NOT NULL,
  rev  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ─── Change tracking ───────────────────────────────────────────────────────
-- One global revision, bumped by every write transaction. Each row remembers the
-- revision that last wrote it, so a client can ask what changed since the one it
-- last saw, and the server can tell a write built on stale state from a fresh one.
-- Deletions leave a tombstone, or a client could never learn a row was removed.

CREATE TABLE IF NOT EXISTS app_tombstones (
  collection TEXT    NOT NULL,
  id         TEXT    NOT NULL,
  rev        INTEGER NOT NULL,
  PRIMARY KEY (collection, id)
);

-- What writers other than the browser did, for the tab to announce. history_id
-- points at the app_history row that can undo it.

CREATE TABLE IF NOT EXISTS app_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  rev        INTEGER NOT NULL,
  source     TEXT    NOT NULL,
  summary    TEXT    NOT NULL,
  history_id INTEGER,
  at         INTEGER NOT NULL
);

-- The row as it was BEFORE an outside write, so that write can be undone. A NULL
-- data column means the row did not exist: undoing a create deletes it.

CREATE TABLE IF NOT EXISTS app_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  collection TEXT    NOT NULL,
  row_id     TEXT    NOT NULL,
  data       TEXT,
  seq        INTEGER,
  rev        INTEGER NOT NULL,
  source     TEXT    NOT NULL,
  at         INTEGER NOT NULL
);

-- ─── Assets ──────────────────────────────────────────────────────────────────
-- Images, stored once by the SHA-256 of their bytes and referenced from rows as
-- /api/assets/<hash>. Inside the database rather than as files so a backup and a
-- restore stay one file. Immutable, so they need no revision: a changed image is a
-- different hash. Unreferenced assets are swept by gcAssets.

CREATE TABLE IF NOT EXISTS app_assets (
  hash       TEXT    PRIMARY KEY,
  mime       TEXT    NOT NULL,
  bytes      BLOB    NOT NULL,
  size       INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_messages_chat ON app_messages(chat_id, seq);
`;

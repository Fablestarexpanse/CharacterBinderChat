// ─── Drawer 2 SQLite Schema ───────────────────────────────────────────────────
// Mirror of fable_drawer2/schema.py

export const CREATE_TABLES_SQL = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS entities (
  id          TEXT    PRIMARY KEY,
  type        TEXT    NOT NULL CHECK(type IN ('character','place','object','faction','concept')),
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS facts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id     TEXT    NOT NULL REFERENCES entities(id),
  predicate      TEXT    NOT NULL,
  object_id      TEXT    REFERENCES entities(id),
  object_literal TEXT,
  t_valid_start  INTEGER NOT NULL,
  t_valid_end    INTEGER,
  t_ingested     INTEGER NOT NULL,
  confidence     REAL    NOT NULL DEFAULT 1.0 CHECK(confidence >= 0.0 AND confidence <= 1.0),
  known_to       TEXT    NOT NULL DEFAULT '[]',
  superseded_by  INTEGER REFERENCES facts(id)
);

CREATE TABLE IF NOT EXISTS relationship_stats (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  observer_id  TEXT    NOT NULL,
  target_id    TEXT    NOT NULL,
  stat_name    TEXT    NOT NULL CHECK(stat_name IN ('affection','trust','desire','connection','mood')),
  value        REAL    NOT NULL DEFAULT 0.0,
  decay_rate   REAL    NOT NULL,
  last_updated INTEGER NOT NULL,
  UNIQUE(observer_id, target_id, stat_name)
);

CREATE TABLE IF NOT EXISTS memory_cards (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  tags       TEXT    NOT NULL DEFAULT '[]',
  entity_ids TEXT    NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS commitments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  promisor_id TEXT    NOT NULL,
  promisee_id TEXT,
  description TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'active' CHECK(status IN ('active','fulfilled','broken','forgotten')),
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject_id);
CREATE INDEX IF NOT EXISTS idx_facts_valid   ON facts(t_valid_start, t_valid_end);
CREATE INDEX IF NOT EXISTS idx_facts_object  ON facts(object_id);
CREATE INDEX IF NOT EXISTS idx_stats_pair    ON relationship_stats(observer_id, target_id);

-- ─── Drawer 1: Core Memory Block ────────────────────────────────────────────
-- One row per character. Stores the always-in-context "conscious mind" state.

CREATE TABLE IF NOT EXISTS core_memory (
  character_id TEXT    PRIMARY KEY,
  data         TEXT    NOT NULL DEFAULT '{}',
  version      INTEGER NOT NULL DEFAULT 1,
  updated_at   INTEGER NOT NULL
);

-- ─── App State: characters / chats / messages ───────────────────────────────
-- Durable mirror of the client store (chats used to live only in
-- localStorage). Rows hold the full JSON of each object and seq preserves
-- array order. Drawer 2 remains the queryable layer — these are storage.
-- NOTE: never put a semicolon inside a comment — _initSchema splits on them.

CREATE TABLE IF NOT EXISTS app_characters (
  id   TEXT    PRIMARY KEY,
  seq  INTEGER NOT NULL,
  data TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS app_chats (
  id   TEXT    PRIMARY KEY,
  seq  INTEGER NOT NULL,
  data TEXT    NOT NULL
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
  data TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_messages_chat ON app_messages(chat_id, seq);
`;

// ─── Durable app state ────────────────────────────────────────────────────────
// The mirror of the client store: characters, chats and their messages,
// personas, lorebooks, scenarios, presets, and two singleton values. Nothing
// here is memory — it is the app's own content, kept in SQLite so a cleared
// browser doesn't lose it.
//
// Plain functions over the Database handle rather than methods: FableStore owns
// the connection and the memory graph, and this is a separate domain that only
// ever needed the handle.

import type { Database as DB } from "better-sqlite3";

import type { PersistedAppState } from "@/lib/types";

// ─── App state collections ────────────────────────────────────────────────────
// The flat collections of the durable app state, paired with their tables. Every
// place that reads, wipes, writes, validates or counts them drives off this list
// rather than repeating five near-identical statements — a new collection is one
// row here plus its table in the schema. Chats are absent on purpose: their
// messages live in a second table, so they are handled separately.

export const APP_COLLECTIONS = [
  ["characters", "app_characters"],
  ["personas",   "app_personas"],
  ["lorebooks",  "app_lorebooks"],
  ["scenarios",  "app_scenarios"],
  ["presets",    "app_presets"],
] as const satisfies ReadonlyArray<readonly [keyof PersistedAppState, string]>;

/** Small singleton values that aren't collections (default preset, global
 *  instructions). Upserted rather than wiped so a client that omits one
 *  doesn't null it. */
function getKv<T>(db: DB, key: string, fallback: T): T {
  const row = db.prepare("SELECT value FROM app_kv WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

/**
 * A row whose JSON no longer parses is dropped rather than throwing: one
 * corrupted character must not make the whole state unreadable, which would
 * look to StateSync exactly like an empty database.
 */
function parseRows<T>(rows: Array<{ data: string }>, table: string): T[] {
  const out: T[] = [];
  for (const r of rows) {
    try {
      out.push(JSON.parse(r.data) as T);
    } catch {
      console.error(`[FableStore] skipping unreadable ${table} row`);
    }
  }
  return out;
}

export function getAppState(db: DB): PersistedAppState {
  const read = <T,>(table: string): T[] =>
    parseRows<T>(db.prepare(`SELECT data FROM ${table} ORDER BY seq`).all() as Array<{ data: string }>, table);

  const chatRows = db
    .prepare("SELECT id, data FROM app_chats ORDER BY seq")
    .all() as Array<{ id: string; data: string }>;
  const msgStmt = db.prepare(
    "SELECT data FROM app_messages WHERE chat_id = ? ORDER BY seq"
  );
  // Each chat is paired with its own row id before anything can be dropped:
  // parseRows skips a row it cannot parse, so indexing back into chatRows by
  // the filtered position would hand every later chat the previous chat's
  // messages — on exactly the corrupted-data path this is meant to survive.
  const chats = chatRows.flatMap((row) => {
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(row.data) as Record<string, unknown>;
    } catch {
      console.error("[FableStore] skipping unreadable app_chats row");
      return [];
    }
    return [{
      ...meta,
      messages: parseRows(msgStmt.all(row.id) as Array<{ data: string }>, "app_messages"),
    }];
  }) as PersistedAppState["chats"];

  return {
    characters: read("app_characters"),
    personas:   read("app_personas"),
    lorebooks:  read("app_lorebooks"),
    scenarios:  read("app_scenarios"),
    presets:    read("app_presets"),
    chats,
    defaultPresetId:    getKv<string | null>(db, "defaultPresetId", null),
    globalInstructions: getKv<PersistedAppState["globalInstructions"]>(db, "globalInstructions", {}),
  };
}

/** `defaultPresetId`/`globalInstructions` omitted (undefined) means "leave as-is". */
export function replaceAppState(
  db: DB,
  state: Partial<PersistedAppState> & Pick<PersistedAppState, "characters" | "chats">
): void {
  const { chats, defaultPresetId, globalInstructions } = state;

  const tx = db.transaction(() => {
    for (const [field, table] of APP_COLLECTIONS) {
      db.prepare(`DELETE FROM ${table}`).run();
      const ins = db.prepare(
        `INSERT OR REPLACE INTO ${table} (id, seq, data) VALUES (?, ?, ?)`
      );
      (state[field] ?? []).forEach((row, i) => ins.run(row.id, i, JSON.stringify(row)));
    }

    // app_kv is upserted, never cleared — an older client that doesn't send
    // these fields must not wipe them.
    const insKv = db.prepare(
      "INSERT OR REPLACE INTO app_kv (key, value) VALUES (?, ?)"
    );
    if (defaultPresetId !== undefined) insKv.run("defaultPresetId", JSON.stringify(defaultPresetId));
    if (globalInstructions !== undefined) insKv.run("globalInstructions", JSON.stringify(globalInstructions));

    // Chats are the one collection that isn't flat: messages live in their
    // own table, keyed by chat, so they are cleared and written together.
    db.prepare("DELETE FROM app_chats").run();
    db.prepare("DELETE FROM app_messages").run();
    const insChat = db.prepare(
      "INSERT OR REPLACE INTO app_chats (id, seq, data) VALUES (?, ?, ?)"
    );
    const insMsg = db.prepare(
      "INSERT OR REPLACE INTO app_messages (id, chat_id, seq, data) VALUES (?, ?, ?, ?)"
    );
    chats.forEach((chat, i) => {
      const { messages = [], ...meta } = chat;
      insChat.run(chat.id, i, JSON.stringify(meta));
      messages.forEach((m, j) => insMsg.run(m.id, chat.id, j, JSON.stringify(m)));
    });
  });
  tx();
}

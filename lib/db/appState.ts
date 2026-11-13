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
  ["openers",    "app_openers"],
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
    openers:    read("app_openers"),
    presets:    read("app_presets"),
    chats,
    defaultPresetId:    getKv<string | null>(db, "defaultPresetId", null),
    globalInstructions: getKv<PersistedAppState["globalInstructions"]>(db, "globalInstructions", {}),
  };
}

// ─── Revisions ────────────────────────────────────────────────────────────────

const REV_KEY = "rev";

/** The latest revision written. 0 for a database nothing has written to yet. */
export function currentRev(db: DB): number {
  return getKv<number>(db, REV_KEY, 0);
}

/**
 * An identifier for this database's lifetime. A restore replaces it, so a tab that
 * remembers revision N of the OLD database can tell it is now talking to a different
 * one (revision numbers mean nothing across databases) and reload.
 */
export function getEpoch(db: DB): string {
  const existing = getKv<string | null>(db, "epoch", null);
  if (existing) return existing;
  const fresh = Math.random().toString(36).slice(2) + Date.now().toString(36);
  db.prepare("INSERT OR REPLACE INTO app_kv (key, value) VALUES ('epoch', ?)").run(JSON.stringify(fresh));
  return fresh;
}

/** Start a new revision. Only call inside the write transaction that uses it. */
function bumpRev(db: DB): number {
  const next = currentRev(db) + 1;
  db.prepare("INSERT OR REPLACE INTO app_kv (key, value) VALUES (?, ?)").run(REV_KEY, JSON.stringify(next));
  return next;
}

/** `defaultPresetId`/`globalInstructions` omitted (undefined) means "leave as-is". */
export function replaceAppState(
  db: DB,
  state: Partial<PersistedAppState> & Pick<PersistedAppState, "characters" | "chats">
): void {
  const { chats, defaultPresetId, globalInstructions } = state;

  const tx = db.transaction(() => {
    const rev = bumpRev(db);
    const tombstone = db.prepare("INSERT OR REPLACE INTO app_tombstones (collection, id, rev) VALUES (?, ?, ?)");
    const forget = db.prepare("DELETE FROM app_tombstones WHERE collection = ? AND id = ?");
    /** Rows about to be wiped that are not coming back leave a tombstone. */
    const tombstoneMissing = (name: string, table: string, keep: Set<string>) => {
      for (const r of db.prepare(`SELECT id FROM ${table}`).all() as Array<{ id: string }>) {
        if (!keep.has(r.id)) tombstone.run(name, r.id, rev);
      }
    };

    for (const [field, table] of APP_COLLECTIONS) {
      const rows = state[field] ?? [];
      tombstoneMissing(field, table, new Set(rows.map((r) => r.id)));
      db.prepare(`DELETE FROM ${table}`).run();
      const ins = db.prepare(
        `INSERT OR REPLACE INTO ${table} (id, seq, data, rev) VALUES (?, ?, ?, ?)`
      );
      rows.forEach((row, i) => { ins.run(row.id, i, JSON.stringify(row), rev); forget.run(field, row.id); });
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
    tombstoneMissing("chats", "app_chats", new Set(chats.map((c) => c.id)));
    db.prepare("DELETE FROM app_chats").run();
    db.prepare("DELETE FROM app_messages").run();
    const insChat = db.prepare(
      "INSERT OR REPLACE INTO app_chats (id, seq, data, rev) VALUES (?, ?, ?, ?)"
    );
    const insMsg = db.prepare(
      "INSERT OR REPLACE INTO app_messages (id, chat_id, seq, data) VALUES (?, ?, ?, ?)"
    );
    chats.forEach((chat, i) => {
      const { messages = [], ...meta } = chat;
      insChat.run(chat.id, i, JSON.stringify(meta), rev);
      forget.run("chats", chat.id);
      messages.forEach((m, j) => insMsg.run(m.id, chat.id, j, JSON.stringify(m)));
    });
  });
  tx();
}

// ─── Incremental update ───────────────────────────────────────────────────────

type PatchName = (typeof APP_COLLECTIONS)[number][0] | "chats";

export interface AppStatePatchInput {
  upserts?:  Partial<Record<PatchName, Array<{ id: string; messages?: Array<{ id: string }> }>>>;
  removals?: Partial<Record<PatchName, string[]>>;
  order?:    Partial<Record<PatchName, string[]>>;
  defaultPresetId?: string | null;
  globalInstructions?: PersistedAppState["globalInstructions"];
}

/** Table for each collection name, chats included. */
const PATCH_TABLES: Record<PatchName, string> = {
  ...Object.fromEntries(APP_COLLECTIONS.map(([f, t]) => [f, t])) as Record<string, string>,
  chats: "app_chats",
} as Record<PatchName, string>;

/**
 * Row counts per collection before and after `patch`, without writing. Lets the
 * route apply its wipe guard to the result of an incremental update, reading
 * ids only (not every message).
 */
export function countAfterPatch(
  db: DB, patch: AppStatePatchInput,
): { before: Record<string, number>; after: Record<string, number> } {
  const before: Record<string, number> = {};
  const after: Record<string, number> = {};
  for (const name of Object.keys(PATCH_TABLES) as PatchName[]) {
    const table = PATCH_TABLES[name];
    const ids = new Set((db.prepare(`SELECT id FROM ${table}`).all() as Array<{ id: string }>).map((r) => r.id));
    before[name] = ids.size;
    for (const id of patch.removals?.[name] ?? []) ids.delete(id);
    for (const r of patch.upserts?.[name] ?? []) ids.add(r.id);
    after[name] = ids.size;
  }
  return { before, after };
}

/**
 * Collections whose content other writers (an agent, another device) edit. When a
 * client's write touches a row that changed on the server after the client last
 * synced, the SERVER's copy wins for these and the client is told, so it can take
 * it. Chats are the opposite: only the browser that is generating writes them, so
 * its copy always wins.
 */
export const SERVER_WINS: readonly PatchName[] = ["characters", "lorebooks", "personas", "scenarios", "openers", "presets"];

export interface PatchConflict {
  collection: PatchName;
  id: string;
  /** The row was edited elsewhere, or deleted elsewhere, since the client's base revision */
  reason: "changed" | "deleted";
}

export interface PatchResult {
  /** Revision after this write (equal to `prevRev` when nothing was written) */
  rev: number;
  /** Revision just before it. If it equals the client's base, nothing else intervened. */
  prevRev: number;
  /** Rows left unwritten because the server's copy won */
  conflicts: PatchConflict[];
}

/**
 * Apply a diff instead of replacing everything. A chat that is upserted has
 * its messages rewritten as a unit (a regenerate or edit can change any of
 * them), but untouched chats cost nothing. New rows append; `order` renumbers
 * a collection's seq so reordering and deletions stay faithful.
 *
 * With `baseRev` (the revision the writer last synced to) a write that would
 * overwrite or delete a SERVER_WINS row changed since then is skipped and
 * reported instead. Without it the write is unconditional, as before.
 */
export function patchAppState(db: DB, patch: AppStatePatchInput, opts: { baseRev?: number } = {}): PatchResult {
  const prevRev = currentRev(db);
  let result: PatchResult = { rev: prevRev, prevRev, conflicts: [] };

  const tx = db.transaction(() => {
    const conflicts: PatchConflict[] = [];
    const skip = new Set<string>();           // "collection:id" rows not to touch

    if (opts.baseRev !== undefined) {
      for (const name of SERVER_WINS) {
        const table = PATCH_TABLES[name];
        const touched = [
          ...(patch.upserts?.[name] ?? []).map((r) => r.id),
          ...(patch.removals?.[name] ?? []),
        ];
        for (const id of touched) {
          const row = db.prepare(`SELECT rev FROM ${table} WHERE id = ?`).get(id) as { rev: number } | undefined;
          const tomb = db.prepare("SELECT rev FROM app_tombstones WHERE collection = ? AND id = ?").get(name, id) as { rev: number } | undefined;
          if (row && row.rev > opts.baseRev) conflicts.push({ collection: name, id, reason: "changed" });
          else if (!row && tomb && tomb.rev > opts.baseRev) conflicts.push({ collection: name, id, reason: "deleted" });
          else continue;
          skip.add(`${name}:${id}`);
        }
      }
    }

    const wanted = (name: PatchName, id: string) => !skip.has(`${name}:${id}`);
    const hasWork =
      Object.keys(PATCH_TABLES).some((n) => {
        const name = n as PatchName;
        return (patch.upserts?.[name] ?? []).some((r) => wanted(name, r.id)) ||
               (patch.removals?.[name] ?? []).some((id) => wanted(name, id));
      }) || patch.defaultPresetId !== undefined || patch.globalInstructions !== undefined;
    const rev = hasWork ? bumpRev(db) : prevRev;

    const tombstone = db.prepare("INSERT OR REPLACE INTO app_tombstones (collection, id, rev) VALUES (?, ?, ?)");
    const forget = db.prepare("DELETE FROM app_tombstones WHERE collection = ? AND id = ?");

    for (const name of Object.keys(PATCH_TABLES) as PatchName[]) {
      const table = PATCH_TABLES[name];

      for (const id of patch.removals?.[name] ?? []) {
        if (!wanted(name, id)) continue;
        const existed = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes > 0;
        if (name === "chats") db.prepare("DELETE FROM app_messages WHERE chat_id = ?").run(id);
        if (existed) tombstone.run(name, id, rev);
      }

      const upsert = db.prepare(
        `INSERT INTO ${table} (id, seq, data, rev)
         VALUES (?, (SELECT COALESCE(MAX(seq), -1) + 1 FROM ${table}), ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, rev = excluded.rev`
      );
      for (const row of patch.upserts?.[name] ?? []) {
        if (!wanted(name, row.id)) continue;
        if (name === "chats") {
          const { messages = [], ...meta } = row;
          upsert.run(row.id, JSON.stringify(meta), rev);
          db.prepare("DELETE FROM app_messages WHERE chat_id = ?").run(row.id);
          const insMsg = db.prepare(
            "INSERT OR REPLACE INTO app_messages (id, chat_id, seq, data) VALUES (?, ?, ?, ?)"
          );
          messages.forEach((m, j) => insMsg.run(m.id, row.id, j, JSON.stringify(m)));
        } else {
          upsert.run(row.id, JSON.stringify(row), rev);
        }
        forget.run(name, row.id);
      }

      const order = patch.order?.[name];
      if (order) {
        const setSeq = db.prepare(`UPDATE ${table} SET seq = ? WHERE id = ?`);
        order.forEach((id, i) => setSeq.run(i, id));
      }
    }

    const insKv = db.prepare("INSERT OR REPLACE INTO app_kv (key, value) VALUES (?, ?)");
    if (patch.defaultPresetId !== undefined) insKv.run("defaultPresetId", JSON.stringify(patch.defaultPresetId));
    if (patch.globalInstructions !== undefined) insKv.run("globalInstructions", JSON.stringify(patch.globalInstructions));

    result = { rev, prevRev, conflicts };
  });
  tx();
  return result;
}

// ─── Reading changes ──────────────────────────────────────────────────────────

export interface ChangedRow {
  /** Position in its collection, so a new row lands where the server has it */
  seq: number;
  /** The row's full JSON (a chat with its messages) */
  data: unknown;
}

export interface ChangesSince {
  /** Latest revision. A client that has applied this response is current up to it. */
  rev: number;
  upserts:  Partial<Record<PatchName, ChangedRow[]>>;
  removals: Partial<Record<PatchName, string[]>>;
  /** Announcements for writes by something other than the browser */
  events:   Array<{ id: number; rev: number; source: string; summary: string; historyId: number | null }>;
}

/** Every row written, and every row deleted, after revision `since`. */
export function getChangesSince(db: DB, since: number): ChangesSince {
  const out: ChangesSince = { rev: currentRev(db), upserts: {}, removals: {}, events: [] };
  const msgs = db.prepare("SELECT data FROM app_messages WHERE chat_id = ? ORDER BY seq");

  for (const name of Object.keys(PATCH_TABLES) as PatchName[]) {
    const table = PATCH_TABLES[name];
    const rows = db.prepare(`SELECT id, seq, data FROM ${table} WHERE rev > ? ORDER BY seq`).all(since) as Array<{ id: string; seq: number; data: string }>;
    const changed: ChangedRow[] = [];
    for (const r of rows) {
      try {
        const data = JSON.parse(r.data) as Record<string, unknown>;
        if (name === "chats") data.messages = parseRows(msgs.all(r.id) as Array<{ data: string }>, "app_messages");
        changed.push({ seq: r.seq, data });
      } catch {
        console.error(`[FableStore] skipping unreadable ${table} row in changes`);
      }
    }
    if (changed.length) out.upserts[name] = changed;

    const gone = db.prepare("SELECT id FROM app_tombstones WHERE collection = ? AND rev > ?").all(name, since) as Array<{ id: string }>;
    if (gone.length) out.removals[name] = gone.map((g) => g.id);
  }

  out.events = (db.prepare(
    "SELECT id, rev, source, summary, history_id AS historyId FROM app_events WHERE rev > ? ORDER BY id"
  ).all(since)) as ChangesSince["events"];
  return out;
}

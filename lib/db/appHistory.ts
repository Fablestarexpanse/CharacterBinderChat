// ─── Outside-write history and events ─────────────────────────────────────────
// When something other than the browser changes a card (an agent, say), two
// records are kept: the row as it was BEFORE, so the change can be undone, and an
// event, so an open tab can say what happened. Both are small and pruned.

import type { Database as DB } from "better-sqlite3";

const KEEP = 500;

export interface HistoryEntry {
  id: number;
  collection: string;
  rowId: string;
  /** The row's JSON before the write; null if it did not exist (undoing a create deletes it) */
  data: string | null;
  seq: number | null;
  rev: number;
  source: string;
}

export function saveHistory(
  db: DB,
  e: { collection: string; rowId: string; data: string | null; seq: number | null; rev: number; source: string },
): number {
  const r = db.prepare(
    "INSERT INTO app_history (collection, row_id, data, seq, rev, source, at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(e.collection, e.rowId, e.data, e.seq, e.rev, e.source, Math.floor(Date.now() / 1000));
  return Number(r.lastInsertRowid);
}

export function getHistory(db: DB, id: number): HistoryEntry | null {
  const r = db.prepare("SELECT * FROM app_history WHERE id = ?").get(id) as
    | { id: number; collection: string; row_id: string; data: string | null; seq: number | null; rev: number; source: string }
    | undefined;
  return r ? { id: r.id, collection: r.collection, rowId: r.row_id, data: r.data, seq: r.seq, rev: r.rev, source: r.source } : null;
}

/** Every history row written in the same transaction (they share a revision). */
export function getHistoryGroup(db: DB, rev: number): HistoryEntry[] {
  const rows = db.prepare("SELECT id FROM app_history WHERE rev = ? ORDER BY id").all(rev) as Array<{ id: number }>;
  return rows.map((r) => getHistory(db, r.id)).filter((h): h is HistoryEntry => h !== null);
}

export function deleteHistory(db: DB, id: number): void {
  db.prepare("DELETE FROM app_history WHERE id = ?").run(id);
}

export function recordEvent(
  db: DB, e: { rev: number; source: string; summary: string; historyId: number | null },
): void {
  db.prepare(
    "INSERT INTO app_events (rev, source, summary, history_id, at) VALUES (?, ?, ?, ?, ?)"
  ).run(e.rev, e.source, e.summary, e.historyId, Math.floor(Date.now() / 1000));
  // Pruned here, in the same transaction as the write that grew them
  for (const t of ["app_events", "app_history"]) {
    db.prepare(`DELETE FROM ${t} WHERE id <= (SELECT MAX(id) FROM ${t}) - ?`).run(KEEP);
  }
}

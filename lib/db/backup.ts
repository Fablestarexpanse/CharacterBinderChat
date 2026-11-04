// ─── Backup and restore ───────────────────────────────────────────────────────
// File-level operations on the SQLite database: write a consistent snapshot, look
// inside a candidate file without trusting it, and swap one in for the live
// database. Server-only.
//
// Why a database snapshot and not the JSON export: the JSON export holds
// characters and chats only. Everything the memory system built (facts, core
// memory, relationship stats, scene cards, branch snapshots) lives in other tables,
// so a "backup" without them loses the part that is hardest to recreate.
//
// Two decisions worth knowing:
//   • API keys are NOT in a backup. They are stored encrypted with a key that lives
//     beside the database, not in it; a backup that carried them would be unreadable
//     elsewhere anyway, and one that did not strip them would put credentials in a
//     file people email and sync. On RESTORE the live keys are carried over, so
//     restoring does not log you out of your providers.
//   • A restore always mints a new epoch. Open tabs compare epochs and reload when it
//     changes, because after a restore their idea of "what changed since revision N"
//     no longer means anything.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

/** Tables a FableChat database must have to be worth restoring. */
export const REQUIRED_TABLES = [
  "app_characters", "app_chats", "app_messages", "app_personas", "app_lorebooks", "app_scenarios",
  "app_presets", "app_kv", "entities", "facts", "relationship_stats", "memory_cards", "commitments", "core_memory",
] as const;

const SQLITE_MAGIC = "SQLite format 3\0";

export interface BackupSummary {
  characters: number; chats: number; messages: number; personas: number; lorebooks: number; scenarios: number;
  facts: number; entities: number;
  /** Unix seconds the backup was written, or null if the file did not record it */
  madeAt: number | null;
  bytes: number;
}

export type InspectResult = { ok: true; summary: BackupSummary } | { ok: false; error: string };

const count = (db: Database.Database, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

/**
 * Look inside a file that claims to be a FableChat backup, without trusting it:
 * right magic bytes, opens read-only, passes SQLite's own integrity check, and has
 * the tables the app needs. Never throws; a failure is an `error` string a person
 * can read.
 */
export function inspectBackup(file: string): InspectResult {
  let fd: number | null = null;
  try {
    const stat = fs.statSync(file);
    if (stat.size < 512) return { ok: false, error: "That file is too small to be a FableChat backup." };
    fd = fs.openSync(file, "r");
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    if (head.toString("latin1") !== SQLITE_MAGIC) return { ok: false, error: "That is not a FableChat backup (it is not a database file)." };
  } catch (e) {
    return { ok: false, error: `Could not read the file: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const integrity = db.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") return { ok: false, error: `The backup is damaged (${String(integrity).slice(0, 120)}).` };

    const have = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name));
    const missing = REQUIRED_TABLES.filter((t) => !have.has(t));
    if (missing.length > 0) return { ok: false, error: `That database is not a FableChat backup (missing ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}).` };

    const made = db.prepare("SELECT value FROM app_kv WHERE key = 'backup_made_at'").get() as { value: string } | undefined;
    return {
      ok: true,
      summary: {
        characters: count(db, "app_characters"), chats: count(db, "app_chats"), messages: count(db, "app_messages"),
        personas: count(db, "app_personas"), lorebooks: count(db, "app_lorebooks"), scenarios: count(db, "app_scenarios"),
        facts: count(db, "facts"), entities: count(db, "entities"),
        madeAt: made ? Number(JSON.parse(made.value)) || null : null,
        bytes: fs.statSync(file).size,
      },
    };
  } catch (e) {
    return { ok: false, error: `Could not open the backup: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    db?.close();
  }
}

/**
 * Write a consistent snapshot of a live database to `dest` using SQLite's online
 * backup API (safe while the app is writing), then make the copy shareable: stamp
 * when it was made, strip stored API keys, and compact it.
 */
export async function writeBackup(live: Database.Database, dest: string): Promise<void> {
  await live.backup(dest);
  const copy = new Database(dest);
  try {
    copy.prepare("INSERT OR REPLACE INTO app_kv (key, value) VALUES ('backup_made_at', ?)").run(JSON.stringify(Math.floor(Date.now() / 1000)));
    copy.prepare("DELETE FROM app_kv WHERE key LIKE 'secret:%'").run();
    copy.exec("VACUUM");
  } finally {
    copy.close();
  }
}

export interface SwapOptions {
  /** The live database file */
  livePath: string;
  /** A validated candidate, in the SAME directory as the live file so the rename is atomic */
  stagedPath: string;
  /** Release the live file. Called after validation, immediately before the swap. */
  closeLive: () => void;
  /** Safety copies of replaced databases to keep. Default 3. */
  keepCopies?: number;
}

export interface SwapResult {
  /** Where the database that was replaced now lives, so a mistake can be undone by hand */
  preRestorePath: string;
  summary: BackupSummary;
}

/**
 * Replace the live database with `stagedPath`.
 *
 * Order matters and every step after the live file is closed has a way back:
 * the old file is renamed (never deleted), and if installing the new one fails
 * the old one is put back. API keys in the live database are written into the new
 * one if it has none, so a restore does not sign you out of your providers.
 */
export function swapInDatabase(o: SwapOptions): SwapResult {
  const inspected = inspectBackup(o.stagedPath);
  if (!inspected.ok) throw new Error(inspected.error);

  // Read the live keys while the live file is still open and consistent
  let secrets: Array<{ key: string; value: string }> = [];
  try {
    const live = new Database(o.livePath, { readonly: true, fileMustExist: true });
    try { secrets = live.prepare("SELECT key, value FROM app_kv WHERE key LIKE 'secret:%'").all() as typeof secrets; }
    finally { live.close(); }
  } catch { /* a live database with no kv table has no keys to carry */ }

  o.closeLive();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const preRestorePath = `${o.livePath}.pre-restore-${stamp}`;
  const sidecars = ["-wal", "-shm"];

  // Move the old database (and any leftover WAL/SHM, which would otherwise be
  // applied to the NEW file) out of the way
  fs.renameSync(o.livePath, preRestorePath);
  for (const s of sidecars) if (fs.existsSync(/*turbopackIgnore: true*/ o.livePath + s)) fs.renameSync(/*turbopackIgnore: true*/ o.livePath + s, /*turbopackIgnore: true*/ preRestorePath + s);

  try {
    fs.renameSync(o.stagedPath, o.livePath);
    const restored = new Database(o.livePath);
    try {
      const has = restored.prepare("SELECT 1 FROM app_kv WHERE key = ?");
      const put = restored.prepare("INSERT INTO app_kv (key, value) VALUES (?, ?)");
      for (const s of secrets) if (!has.get(s.key)) put.run(s.key, s.value);
      restored.prepare("INSERT OR REPLACE INTO app_kv (key, value) VALUES ('epoch', ?)").run(JSON.stringify(randomBytes(12).toString("hex")));
      restored.prepare("DELETE FROM app_kv WHERE key = 'backup_made_at'").run();
    } finally {
      restored.close();
    }
  } catch (e) {
    // Put the old database back; the caller reopens it as if nothing happened
    // The paths are computed on purpose (the live file and its safety copy), so the
    // bundler is told not to treat them as project files to trace.
    try { fs.rmSync(o.livePath, { force: true }); for (const s of sidecars) fs.rmSync(/*turbopackIgnore: true*/ o.livePath + s, { force: true }); } catch { /* best effort */ }
    fs.renameSync(preRestorePath, o.livePath);
    for (const s of sidecars) if (fs.existsSync(/*turbopackIgnore: true*/ preRestorePath + s)) fs.renameSync(/*turbopackIgnore: true*/ preRestorePath + s, /*turbopackIgnore: true*/ o.livePath + s);
    throw new Error(`Restore failed and was rolled back: ${e instanceof Error ? e.message : String(e)}`);
  }

  pruneCopies(o.livePath, o.keepCopies ?? 3);
  return { preRestorePath, summary: inspected.summary };
}

/** Keep the newest `keep` safety copies of replaced databases; delete the rest. */
export function pruneCopies(livePath: string, keep: number): void {
  const dir = path.dirname(livePath), base = path.basename(livePath) + ".pre-restore-";
  const copies = fs.readdirSync(dir)
    .filter((f) => f.startsWith(base) && !f.endsWith("-wal") && !f.endsWith("-shm"))
    .sort()                                           // the timestamp sorts chronologically
    .reverse();
  for (const old of copies.slice(keep)) {
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(path.join(dir, old + suffix), { force: true });
  }
}

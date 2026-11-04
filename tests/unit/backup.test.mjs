// Backup and restore work on the live database file, so this is the code that can
// lose everything. Each test uses real SQLite files in a temp directory. What must
// hold: a backup contains the MEMORY (not just chats), never contains API keys, a
// bad file changes nothing, and a failed swap puts the old database back.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { FableStore } = await import("../../lib/db/store.ts");
const { inspectBackup, swapInDatabase, pruneCopies } = await import("../../lib/db/backup.ts");
const Database = (await import("better-sqlite3")).default;

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "fable-backup-"));

/** A store with chats AND memory, so a backup that forgets the memory is caught. */
function populated(file) {
  const s = new FableStore(file);
  s.patchAppState({ upserts: { characters: [{ id: "ash", name: "Ash", description: "d", tags: [] }], chats: [{ id: "c1", characterId: "ash", messages: [{ id: "m1", chatId: "c1", role: "user", content: "hi" }] }] } });
  s.ensureEntity("c1", "ash", "character", "Ash");
  s.assertFact("c1", { subjectId: "ash", predicate: "likes", objectLiteral: "tea" });
  s.assertFact("c1", { subjectId: "ash", predicate: "fears", objectLiteral: "storms" });
  s.db.prepare("INSERT INTO core_memory (chat_id, character_id, data, version, updated_at) VALUES ('c1','ash','{\"narrative_summary\":\"remembered\"}',1,1)").run();
  s.setKv("secret:openrouterApiKey", "v1:CIPHERTEXT");
  return s;
}

test("a backup contains the memory, not just the chats", async () => {
  const dir = tmp(), live = path.join(dir, "live.db"), out = path.join(dir, "b.db");
  const s = populated(live);
  await s.backupTo(out);
  const r = inspectBackup(out);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.summary.characters, 1);
  assert.equal(r.summary.chats, 1);
  assert.equal(r.summary.messages, 1);
  assert.equal(r.summary.facts, 2, "the facts are in the backup");
  assert.ok(r.summary.madeAt > 0, "it says when it was made");
  const copy = new Database(out, { readonly: true });
  assert.match(copy.prepare("SELECT data FROM core_memory").get().data, /remembered/, "core memory too");
  copy.close(); s.close();
});

test("a backup never contains stored API keys", async () => {
  const dir = tmp(), live = path.join(dir, "live.db"), out = path.join(dir, "b.db");
  const s = populated(live);
  await s.backupTo(out);
  const copy = new Database(out, { readonly: true });
  assert.equal(copy.prepare("SELECT COUNT(*) n FROM app_kv WHERE key LIKE 'secret:%'").get().n, 0);
  copy.close();
  assert.ok(!fs.readFileSync(out).toString("latin1").includes("CIPHERTEXT"), "not even as leftover bytes (the copy is vacuumed)");
  assert.equal(s.getKv("secret:openrouterApiKey"), "v1:CIPHERTEXT", "the live database keeps its keys");
  s.close();
});

test("a backup taken while the app is writing is still a valid database", async () => {
  const dir = tmp(), s = populated(path.join(dir, "live.db"));
  const writer = setInterval(() => s.patchAppState({ upserts: { characters: [{ id: "x", name: "N" + Math.random(), description: "d", tags: [] }] } }), 1);
  await s.backupTo(path.join(dir, "b.db"));
  clearInterval(writer);
  assert.equal(inspectBackup(path.join(dir, "b.db")).ok, true);
  s.close();
});

test("files that are not backups are refused, each with a reason a person can read", () => {
  const dir = tmp();
  const write = (name, bytes) => { const f = path.join(dir, name); fs.writeFileSync(f, bytes); return f; };

  assert.match(inspectBackup(write("empty.db", "")).error, /too small/);
  assert.match(inspectBackup(write("text.db", "this is not a database ".repeat(100))).error, /not a database file/);
  assert.match(inspectBackup(path.join(dir, "missing.db")).error, /Could not read/);

  // a real SQLite file that is not ours
  const other = path.join(dir, "other.db");
  const o = new Database(other); o.exec("CREATE TABLE notes (a TEXT); INSERT INTO notes VALUES ('x');" + " ".repeat(10)); o.pragma("page_size = 4096"); o.close();
  fs.appendFileSync(other, Buffer.alloc(1024));
  assert.match(inspectBackup(other).error, /not a FableChat backup \(missing app_characters/);
});

test("a truncated backup is caught rather than half-restored", async () => {
  const dir = tmp(), s = populated(path.join(dir, "live.db")), out = path.join(dir, "b.db");
  // pad the data so the file has real size to cut
  for (let i = 0; i < 400; i++) s.assertFact("c1", { subjectId: "ash", predicate: `p${i}`, objectLiteral: "x".repeat(200) });
  await s.backupTo(out); s.close();
  const full = fs.readFileSync(out);
  fs.writeFileSync(out, full.subarray(0, Math.floor(full.length * 0.6)));
  assert.equal(inspectBackup(out).ok, false);
});

test("restoring replaces the database and brings the memory back", async () => {
  const dir = tmp(), live = path.join(dir, "live.db"), out = path.join(dir, "b.db");
  const original = populated(live);
  await original.backupTo(out);

  // the live database moves on: different data
  original.patchAppState({ removals: { characters: ["ash"] } });
  original.db.prepare("DELETE FROM facts").run();
  const staged = path.join(dir, ".staged-x.db"); fs.copyFileSync(out, staged);

  const res = swapInDatabase({ livePath: live, stagedPath: staged, closeLive: () => original.close() });
  assert.ok(fs.existsSync(res.preRestorePath), "the replaced database is kept");

  const restored = new FableStore(live);
  assert.equal(restored.getAppState().characters[0].name, "Ash");
  assert.equal(restored.queryFacts("c1", "ash").length, 2, "the facts came back");
  assert.match(restored.db.prepare("SELECT data FROM core_memory").get().data, /remembered/);
  restored.close();
});

test("restore keeps the live API keys, and mints a new epoch so open tabs reload", async () => {
  const dir = tmp(), live = path.join(dir, "live.db"), out = path.join(dir, "b.db");
  const s = populated(live);
  const epochBefore = s.epoch();
  await s.backupTo(out);
  const staged = path.join(dir, ".staged-y.db"); fs.copyFileSync(out, staged);
  swapInDatabase({ livePath: live, stagedPath: staged, closeLive: () => s.close() });

  const after = new FableStore(live);
  assert.equal(after.getKv("secret:openrouterApiKey"), "v1:CIPHERTEXT", "restoring does not sign you out of your providers");
  assert.notEqual(after.epoch(), epochBefore);
  assert.equal(after.getKv("backup_made_at"), null, "the backup stamp is not carried into the live database");
  after.close();
});

test("a bad file changes nothing: the live database is not even closed", () => {
  const dir = tmp(), live = path.join(dir, "live.db");
  const s = populated(live);
  const bad = path.join(dir, ".staged-bad.db"); fs.writeFileSync(bad, "junk".repeat(500));
  let closed = false;
  assert.throws(() => swapInDatabase({ livePath: live, stagedPath: bad, closeLive: () => { closed = true; s.close(); } }), /not a database file/);
  assert.equal(closed, false, "validation happens before anything is touched");
  assert.equal(s.getAppState().characters.length, 1);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes("pre-restore")), []);
  s.close();
});

test("if installing the new file fails, the old database is put back", async () => {
  const dir = tmp(), live = path.join(dir, "live.db"), out = path.join(dir, "b.db");
  const s = populated(live);
  await s.backupTo(out);
  const staged = path.join(dir, ".staged-z.db"); fs.copyFileSync(out, staged);

  // sabotage: make the post-install step fail by making the installed file unreadable as a database after rename
  const realRename = fs.renameSync;
  let renames = 0;
  fs.renameSync = (a, b) => {
    realRename(a, b);
    if (++renames === 2) fs.writeFileSync(b, Buffer.alloc(2048, 7));   // the "new" file arrives corrupt
  };
  try {
    assert.throws(() => swapInDatabase({ livePath: live, stagedPath: staged, closeLive: () => s.close() }), /rolled back/);
  } finally {
    fs.renameSync = realRename;
  }
  const back = new FableStore(live);
  assert.equal(back.getAppState().characters[0].name, "Ash", "the original is back, intact");
  assert.equal(back.queryFacts("c1", "ash").length, 2);
  back.close();
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes("pre-restore") && !f.endsWith("-wal") && !f.endsWith("-shm")), [], "no stray safety copy after a rollback");
});

test("only the newest few safety copies are kept", () => {
  const dir = tmp(), live = path.join(dir, "live.db");
  for (let i = 1; i <= 6; i++) fs.writeFileSync(`${live}.pre-restore-2026-01-0${i}T00-00-00-000Z`, "x");
  fs.writeFileSync(`${live}.pre-restore-2026-01-06T00-00-00-000Z-wal`, "w");
  pruneCopies(live, 3);
  const left = fs.readdirSync(dir).filter((f) => f.includes("pre-restore") && !f.endsWith("-wal")).sort();
  assert.deepEqual(left, [4, 5, 6].map((d) => `live.db.pre-restore-2026-01-0${d}T00-00-00-000Z`), "the three newest remain");
  assert.ok(fs.existsSync(`${live}.pre-restore-2026-01-06T00-00-00-000Z-wal`), "a kept copy keeps its sidecar");
});

test("the epoch is stable until something replaces the database", () => {
  const s = new FableStore(":memory:");
  const e = s.epoch();
  assert.equal(s.epoch(), e);
  s.patchAppState({ upserts: { characters: [{ id: "a", name: "A", description: "d", tags: [] }] } });
  assert.equal(s.epoch(), e, "ordinary writes do not change it");
});

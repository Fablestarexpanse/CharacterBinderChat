// The TypeScript port and the Python prototype (fable_drawer2/schema.py) share
// a bi-temporal core, and AGENTS.md names the prototype as the spec for that
// behaviour. The schemas are NOT identical — the app scopes everything by
// chat, adds importance and embeddings, and renames a few card and commitment
// columns — so this asserts the part that must not drift: the columns the
// bi-temporal model is made of.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { APP_ROOT, load } from "./_load.mjs";

const { CREATE_TABLES_SQL } = await load("lib/db/schema.ts");

/** Build a fresh database exactly the way FableStore._initSchema does. */
function freshDb() {
  const db = new Database(":memory:");
  const statements = CREATE_TABLES_SQL
    .split(";")
    .map((chunk) => chunk.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim())
    .filter((s) => s.length > 0);
  for (const sql of statements) db.exec(sql + ";");
  return db;
}

const columns = (db, table) =>
  new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));

test("the schema executes statement-by-statement the way the store splits it", () => {
  // A semicolon inside a SQL comment truncates a statement and the table
  // silently fails to create — this is that guard.
  const db = freshDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ["entities", "facts", "relationship_stats", "memory_cards", "commitments", "core_memory"]) {
    assert.ok(tables.includes(t), `missing table: ${t}`);
  }
  db.close();
});

test("facts keep the bi-temporal columns the Python spec defines", () => {
  const db = freshDb();
  const cols = columns(db, "facts");
  for (const c of ["t_valid_start", "t_valid_end", "t_ingested", "confidence", "known_to", "superseded_by"]) {
    assert.ok(cols.has(c), `facts is missing ${c}`);
  }
  db.close();
});

test("every memory table is chat-scoped — the app's one deliberate divergence", () => {
  const db = freshDb();
  for (const t of ["entities", "facts", "relationship_stats", "memory_cards", "commitments", "core_memory"]) {
    assert.ok(columns(db, t).has("chat_id"), `${t} is not chat-scoped`);
  }
  db.close();
});

test("the columns added after v1 are in the schema, not only in _ensureColumns", () => {
  const db = freshDb();
  assert.ok(columns(db, "facts").has("importance"));
  assert.ok(columns(db, "facts").has("embedding"));
  assert.ok(columns(db, "memory_cards").has("importance"));
  assert.ok(columns(db, "memory_cards").has("embedding"));
  assert.ok(columns(db, "relationship_stats").has("rupture_recovery"));
  db.close();
});

test("the Python spec is still where AGENTS.md says it is", () => {
  // If the prototype moves or goes, the claim in AGENTS.md needs updating too.
  const spec = path.join(APP_ROOT, "..", "fable_drawer2", "schema.py");
  assert.ok(fs.existsSync(spec), `bi-temporal spec not found at ${spec}`);
  const py = fs.readFileSync(spec, "utf8");
  for (const c of ["t_valid_start", "t_valid_end", "t_ingested", "superseded_by"]) {
    assert.ok(py.includes(c), `spec no longer defines ${c}`);
  }
});

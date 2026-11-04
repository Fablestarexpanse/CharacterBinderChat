// Branching must hand the new chat the memory the story had AT the branch
// point. The failure modes are all silent: a branch that remembers the future,
// a fact left superseded by something that "hasn't happened", or memory
// deleted as an orphan because its chat was not saved yet.

import { test } from "node:test";
import assert from "node:assert/strict";

const { FableStore } = await import("../../lib/db/store.ts");

const SRC = "src";

function world() {
  const store = new FableStore(":memory:");
  const db = store.db;
  const ent = db.prepare("INSERT INTO entities (chat_id, id, type, name, description, created_at) VALUES (?,?,?,?,?,?)");
  ent.run(SRC, "ash", "character", "Ash", "", 100);
  ent.run(SRC, "player", "character", "Player", "", 100);
  ent.run(SRC, "late-town", "place", "Late Town", "", 500);          // appears after the cutoff

  const fact = db.prepare(
    `INSERT INTO facts (chat_id, subject_id, predicate, object_literal, t_valid_start, t_valid_end, t_ingested, known_to, superseded_by)
     VALUES (?, ?, ?, ?, 0, ?, ?, '[]', ?)`
  );
  // fact 1: lives in Oak, superseded at t=400 by fact 3 (after cutoff 300)
  fact.run(SRC, "ash", "lives_in", "Oak", 400, 150, null);
  // fact 2: ordinary, before cutoff
  fact.run(SRC, "ash", "likes", "tea", null, 200, null);
  // fact 3: the replacement, ingested AFTER the cutoff
  fact.run(SRC, "ash", "lives_in", "Late Town", null, 400, null);
  db.prepare("UPDATE facts SET superseded_by = 3 WHERE id = 1").run();   // set once the target row exists (FK)

  db.prepare("INSERT INTO relationship_stats (chat_id, observer_id, target_id, stat_name, value, decay_rate, rupture_recovery, last_updated) VALUES (?,?,?,?,?,?,?,?)")
    .run(SRC, "ash", "player", "trust", 80, 0.01, 0, 450);          // live value, far ahead of the story at the branch point
  db.prepare("INSERT INTO core_memory (chat_id, character_id, data, version, updated_at) VALUES (?,?,?,?,?)")
    .run(SRC, "ash", JSON.stringify({ narrative_summary: "LIVE" }), 9, 450);

  const commit = db.prepare("INSERT INTO commitments (chat_id, promisor_id, description, status, created_at, resolved_at) VALUES (?,?,?,?,?,?)");
  commit.run(SRC, "ash", "bring tea", "fulfilled", 250, 420);        // resolved after the cutoff
  commit.run(SRC, "ash", "future vow", "active", 450, null);         // made after the cutoff

  db.prepare("INSERT INTO memory_cards (chat_id, title, content, created_at, updated_at) VALUES (?,?,?,?,?)").run(SRC, "early", "x", 200, 200);
  db.prepare("INSERT INTO memory_cards (chat_id, title, content, created_at, updated_at) VALUES (?,?,?,?,?)").run(SRC, "late", "y", 450, 450);
  return store;
}

const q = (store, sql, ...a) => store.db.prepare(sql).all(...a);

test("without a snapshot, a rewind drops later memory and flags itself approximate", () => {
  const store = world();
  const r = store.branchMemory({ fromChatId: SRC, toChatId: "b1", keptMessageIds: ["m1"], fallbackCutoff: 300, messageIdMap: { m1: "n1" } });

  assert.equal(r.approximate, true);
  const preds = q(store, "SELECT predicate, object_literal FROM facts WHERE chat_id='b1' ORDER BY id");
  assert.deepEqual(preds.map((f) => f.object_literal), ["Oak", "tea"], "the post-cutoff fact is not copied");
  assert.equal(q(store, "SELECT 1 FROM entities WHERE chat_id='b1' AND id='late-town'").length, 0);
  assert.equal(q(store, "SELECT title FROM memory_cards WHERE chat_id='b1'").map((c) => c.title).join(), "early");
});

test("a fact superseded only after the cutoff is reopened in the branch", () => {
  const store = world();
  store.branchMemory({ fromChatId: SRC, toChatId: "b1", keptMessageIds: [], fallbackCutoff: 300, messageIdMap: {} });
  const oak = q(store, "SELECT t_valid_end, superseded_by FROM facts WHERE chat_id='b1' AND object_literal='Oak'")[0];
  assert.equal(oak.superseded_by, null);
  assert.equal(oak.t_valid_end, null, "it is still true in this timeline");
});

test("a supersession that DID happen before the cutoff is kept and remapped", () => {
  const store = world();
  // everything counts: the replacement is in, so Oak stays superseded — by the copy's own id
  store.branchMemory({ fromChatId: SRC, toChatId: "b1", keptMessageIds: [], fallbackCutoff: null, messageIdMap: {} });
  const rows = q(store, "SELECT id, object_literal, superseded_by FROM facts WHERE chat_id='b1' ORDER BY id");
  const oak = rows.find((r) => r.object_literal === "Oak");
  const replacement = rows.find((r) => r.object_literal === "Late Town");
  assert.equal(oak.superseded_by, replacement.id, "points inside the branch, not at the source's id");
});

test("a commitment resolved after the cutoff is active again; one made after is absent", () => {
  const store = world();
  store.branchMemory({ fromChatId: SRC, toChatId: "b1", keptMessageIds: [], fallbackCutoff: 300, messageIdMap: {} });
  const rows = q(store, "SELECT description, status, resolved_at FROM commitments WHERE chat_id='b1'");
  assert.deepEqual(rows, [{ description: "bring tea", status: "active", resolved_at: null }]);
});

test("a snapshot supplies stats and core memory exactly, and sets the cutoff", () => {
  const store = world();
  // Snapshot of an earlier moment, then the live state moves on (world() already holds trust=80)
  store.db.prepare("INSERT INTO memory_snapshots (chat_id, message_id, created_at, data) VALUES (?,?,?,?)").run(
    SRC, "m1", 300,
    JSON.stringify({
      core: [{ character_id: "ash", data: JSON.stringify({ narrative_summary: "THEN" }), version: 3, updated_at: 290 }],
      stats: [{ observer_id: "ash", target_id: "player", stat_name: "trust", value: 12, decay_rate: 0.01, rupture_recovery: 0, last_updated: 290 }],
    }),
  );
  const r = store.branchMemory({ fromChatId: SRC, toChatId: "b1", keptMessageIds: ["m0", "m1"], fallbackCutoff: 999, messageIdMap: { m0: "n0", m1: "n1" } });

  assert.equal(r.approximate, false);
  assert.equal(q(store, "SELECT value FROM relationship_stats WHERE chat_id='b1'")[0].value, 12, "snapshot value, not the live 80");
  assert.match(q(store, "SELECT data FROM core_memory WHERE chat_id='b1'")[0].data, /THEN/);
  // the snapshot's own time is the cutoff, even though the caller's fallback was far later
  assert.equal(q(store, "SELECT COUNT(*) n FROM facts WHERE chat_id='b1'")[0].n, 2);
  // and it travels with the branch under the new message id
  assert.equal(q(store, "SELECT created_at FROM memory_snapshots WHERE chat_id='b1' AND message_id='n1'").length, 1);
});

test("branching from the latest message copies everything and is not approximate", () => {
  const store = world();
  const r = store.branchMemory({ fromChatId: SRC, toChatId: "b1", keptMessageIds: ["m1"], fallbackCutoff: null, messageIdMap: { m1: "n1" } });
  assert.equal(r.approximate, false);
  assert.equal(r.facts, 3);
  assert.equal(r.commitments, 2);
});

test("the source chat is untouched", () => {
  const store = world();
  const before = JSON.stringify(q(store, "SELECT * FROM facts WHERE chat_id=? ORDER BY id", SRC));
  store.branchMemory({ fromChatId: SRC, toChatId: "b1", keptMessageIds: [], fallbackCutoff: 300, messageIdMap: {} });
  assert.equal(JSON.stringify(q(store, "SELECT * FROM facts WHERE chat_id=? ORDER BY id", SRC)), before);
});

test("saveMemorySnapshot captures core memory and stats, and purge removes snapshots with their chat", () => {
  const store = world();
  store.saveMemorySnapshot(SRC, "m9");
  const snap = JSON.parse(q(store, "SELECT data FROM memory_snapshots WHERE chat_id=? AND message_id='m9'", SRC)[0].data);
  assert.equal(snap.core.length, 1);
  assert.equal(snap.stats[0].value, 80);
  store.purgeChatMemory(SRC);
  assert.equal(q(store, "SELECT 1 FROM memory_snapshots WHERE chat_id=?", SRC).length, 0);
});

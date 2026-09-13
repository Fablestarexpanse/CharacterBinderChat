// Carrying memory from one chat into another. This is the only path that
// copies Drawer 1 and Drawer 2 rows between chats, it runs once at chat
// creation, and getting it wrong is invisible until someone notices a
// character remembering the wrong life. Two rules matter most: the target
// chat's own rows win every collision, and fact supersession links must be
// remapped onto the copied ids or the copy arrives with facts pointing at
// rows in the source chat.

import { test } from "node:test";
import assert from "node:assert/strict";

const { FableStore } = await import("../../lib/db/store.ts");

const FROM = "chat-source";
const TO   = "chat-target";

function storeWithSource() {
  const store = new FableStore(":memory:");
  for (const id of ["ash", "player", "kael"]) store.ensureEntity(FROM, id, "character", id);
  store.assertFact(FROM, { subjectId: "ash", predicate: "knows", objectId: "kael" });
  store.deltaStat(FROM, "ash", "player", "trust", 20);
  store.insertCommitment(FROM, "ash", "buy breakfast", "player");
  store.insertMemoryCard(FROM, {
    title: "The flooded crossing", content: "She froze on the bank.",
    tags: ["episode"], entityIds: ["ash"], importance: 0.8,
  });
  store.ensureCoreMemory(FROM, "ash", "Ash");
  return store;
}

test("transfer copies entities, facts and stats into an empty chat", () => {
  const store = storeWithSource();

  const copied = store.transferMemory(FROM, TO);

  assert.ok(copied.entities >= 3, "every source entity should arrive");
  assert.ok(copied.facts >= 1);
  assert.ok(copied.stats >= 1);
  assert.equal(store.queryFacts(TO, "ash").length, 1);
  assert.equal(store.getStat(TO, "ash", "player", "trust").value, 20);
  assert.equal(store.listMemoryCards(TO).length, 1);
  assert.ok(store.getCoreMemory(TO, "ash"), "Drawer 1 comes across too");
});

test("the source chat keeps everything it had", () => {
  const store = storeWithSource();
  store.transferMemory(FROM, TO);

  assert.equal(store.queryFacts(FROM, "ash").length, 1, "a transfer is a copy, not a move");
  assert.equal(store.getStat(FROM, "ash", "player", "trust").value, 20);
});

test("the target chat wins every collision", () => {
  const store = storeWithSource();
  // The target already knows Ash, and rates her differently. Read the value
  // back rather than asserting the delta: deltaStat scales negatives by 1.5.
  store.ensureEntity(TO, "ash", "character", "Ash");
  store.ensureEntity(TO, "player", "character", "player");
  store.deltaStat(TO, "ash", "player", "trust", -5);
  const before = store.getStat(TO, "ash", "player", "trust").value;
  assert.notEqual(before, 20, "precondition: the two chats disagree");

  store.transferMemory(FROM, TO);

  assert.equal(store.getStat(TO, "ash", "player", "trust").value, before,
    "the target's own rating must survive the copy");
});

test("supersession links are remapped onto the copied facts", () => {
  const store = storeWithSource();
  const first  = store.assertFact(FROM, { subjectId: "ash", predicate: "lives_at", objectLiteral: "Harbor" });
  const second = store.assertFact(FROM, { subjectId: "ash", predicate: "current_location", objectLiteral: "Uptown" });
  assert.deepEqual(second.superseded, [first.factId], "precondition: the second closed the first");

  store.transferMemory(FROM, TO);

  // The copied chat must show the same one live location, not both and not
  // a fact pointing at a row id that belongs to the source chat.
  const live = store.queryFacts(TO, "ash").filter((f) => f.supersededBy == null);
  const locations = live.filter((f) => f.predicate === "lives_at" || f.predicate === "current_location");
  assert.equal(locations.length, 1, "exactly one live location should arrive");
  assert.equal(locations[0].objectLiteral, "Uptown");

  const superseded = store.queryFacts(TO, "ash").filter((f) => f.supersededBy != null);
  for (const fact of superseded) {
    const target = store.queryFacts(TO, "ash").find((f) => f.id === fact.supersededBy);
    assert.ok(target, `superseded_by ${fact.supersededBy} must point at a fact in the target chat`);
  }
});

test("listMemorySources reports each chat that holds memory for a character", () => {
  const store = storeWithSource();
  store.transferMemory(FROM, TO);

  const sources = store.listMemorySources("ash");
  const chatIds = sources.map((s) => s.chatId).sort();
  assert.deepEqual(chatIds, [FROM, TO].sort());
  for (const source of sources) {
    assert.equal(typeof source.facts, "number");
    assert.equal(source.chatName, null, "no app_chats row was written, so there is no name to find");
  }
});

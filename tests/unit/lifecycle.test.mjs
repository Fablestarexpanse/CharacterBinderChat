// What happens to memory when the thing it belongs to changes: a chat is
// deleted, two entities turn out to be one, a new chat inherits an old one's
// memories, the durable copy is replaced wholesale. These paths run rarely and
// destroy data when they are wrong.

import { test } from "node:test";
import assert from "node:assert/strict";

const { FableStore } = await import("../../lib/db/store.ts");

const CHAT = "c1";

function seeded() {
  const store = new FableStore(":memory:");
  for (const id of ["ash", "player", "kael"]) store.ensureEntity(CHAT, id, "character", id);
  store.assertFact(CHAT, { subjectId: "ash", predicate: "knows", objectId: "kael" });
  store.assertFact(CHAT, { subjectId: "ash", predicate: "fears", objectLiteral: "deep water" });
  store.deltaStat(CHAT, "ash", "player", "trust", 10);
  store.insertCommitment(CHAT, "ash", "buy breakfast", "player");
  store.ensureCoreMemory(CHAT, "ash", "Ash");
  return store;
}

test("deleting a fact revives what it superseded", () => {
  const store = seeded();
  const first  = store.assertFact(CHAT, { subjectId: "ash", predicate: "lives_at", objectLiteral: "Harbor" });
  const second = store.assertFact(CHAT, { subjectId: "ash", predicate: "current_location", objectLiteral: "Uptown" });
  assert.deepEqual(second.superseded, [first.factId]);

  // Removing the successor must not leave the predecessor closed — that would
  // erase both versions of the truth and dangle superseded_by.
  const result = store.deleteFact(CHAT, second.factId);
  assert.equal(result.deleted, true);
  assert.equal(result.revived, 1);

  const live = store.queryFacts(CHAT, "ash").map((f) => f.objectLiteral);
  assert.ok(live.includes("Harbor"));
  assert.equal(live.includes("Uptown"), false);
});

test("deleting a fact that isn't there reports it rather than throwing", () => {
  assert.deepEqual(seeded().deleteFact(CHAT, 9999), { deleted: false, revived: 0 });
});

test("merging two entities moves the facts and drops the duplicate", () => {
  const store = seeded();
  store.ensureEntity(CHAT, "kael-2", "character", "Kael");
  store.assertFact(CHAT, { subjectId: "kael-2", predicate: "carries", objectLiteral: "a stopwatch" });

  store.mergeEntity(CHAT, "kael-2", "kael");

  assert.equal(store.getEntity(CHAT, "kael-2"), null, "the folded entity should be gone");
  const kaelFacts = store.queryFacts(CHAT, "kael").map((f) => f.objectLiteral);
  assert.ok(kaelFacts.includes("a stopwatch"), "its facts should have moved, not vanished");
});

test("purging a chat takes all of its memory and nothing else", () => {
  const store = seeded();
  const other = "c2";
  store.ensureEntity(other, "ash", "character", "ash");
  store.assertFact(other, { subjectId: "ash", predicate: "fears", objectLiteral: "heights" });

  store.purgeChatMemory(CHAT);

  assert.equal(store.queryFacts(CHAT, "ash").length, 0);
  assert.equal(store.listEntities(CHAT).length, 0);
  assert.equal(store.getCoreMemory(CHAT, "ash"), null);
  assert.equal(store.queryFacts(other, "ash").length, 1, "the other chat must be untouched");
});

test("orphan purge spares 'legacy' — the pre-migration scope", () => {
  const store = seeded();
  store.ensureEntity("legacy", "ash", "character", "ash");
  store.assertFact("legacy", { subjectId: "ash", predicate: "fears", objectLiteral: "the dark" });
  // No app_chats rows exist, so every chat id looks orphaned.
  const purged = store.purgeOrphanedChatMemory();
  assert.ok(purged.includes(CHAT));
  assert.equal(purged.includes("legacy"), false);
  assert.equal(store.queryFacts("legacy", "ash").length, 1);
});

test("transfer copies memory forward without touching the source", () => {
  const store = seeded();
  const copied = store.transferMemory(CHAT, "c-new");
  assert.ok(copied.facts >= 2, `expected the facts to come across, got ${copied.facts}`);
  assert.ok(copied.entities >= 3);

  assert.equal(store.queryFacts("c-new", "ash").length, store.queryFacts(CHAT, "ash").length);
  assert.equal(store.queryFacts(CHAT, "ash").length, 2, "the source chat keeps its own memory");
});

test("replaceAppState is a full replace, and keeps singletons it isn't given", () => {
  const store = new FableStore(":memory:");
  store.replaceAppState({
    characters: [{ id: "char-ash", name: "Ash" }],
    chats: [{ id: "chat-1", name: "First", messages: [{ id: "m1", role: "user", content: "hi" }] }],
    defaultPresetId: "preset-1",
  });
  let state = store.getAppState();
  assert.equal(state.characters.length, 1);
  assert.equal(state.chats[0].messages.length, 1);
  assert.equal(state.defaultPresetId, "preset-1");

  // A later sync that omits the singleton must not null it — an older client
  // that doesn't send the field would otherwise clear the user's default.
  store.replaceAppState({ characters: [], chats: [] });
  state = store.getAppState();
  assert.equal(state.characters.length, 0, "collections are replaced wholesale");
  assert.equal(state.defaultPresetId, "preset-1", "the singleton survives");
});

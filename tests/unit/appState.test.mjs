// The durable app state: the read that hydrates the whole app on load, and
// the row mappers under it. Both exist to survive data that is already broken,
// so that is what is asserted here — a row with unreadable JSON must be
// skipped without taking its neighbours with it, and above all without
// shifting the rows after it onto the wrong parent.

import { test } from "node:test";
import assert from "node:assert/strict";

const { FableStore } = await import("../../lib/db/store.ts");
const { rowToEntity, rowToFact, rowToMemoryCard, rowToCommitment } =
  await import("../../lib/db/rows.ts");

/** A store with three chats, each carrying one message. */
function seeded() {
  const store = new FableStore(":memory:");
  store.replaceAppState({
    characters: [{ id: "ash", name: "Ash" }],
    personas: [], lorebooks: [], scenarios: [], presets: [],
    chats: [
      { id: "c1", characterId: "ash", messages: [{ id: "m1", chatId: "c1", role: "user", content: "first" }] },
      { id: "c2", characterId: "ash", messages: [{ id: "m2", chatId: "c2", role: "user", content: "second" }] },
      { id: "c3", characterId: "ash", messages: [{ id: "m3", chatId: "c3", role: "user", content: "third" }] },
    ],
    defaultPresetId: null,
    globalInstructions: {},
  });
  return store;
}

test("a round trip returns every chat with its own messages", () => {
  const state = seeded().getAppState();

  assert.deepEqual(state.chats.map((c) => c.id), ["c1", "c2", "c3"]);
  for (const chat of state.chats) {
    assert.equal(chat.messages.length, 1);
    assert.equal(chat.messages[0].chatId, chat.id, "a message must belong to its own chat");
  }
});

test("a corrupted chat row is skipped without shifting the ones after it", () => {
  const store = seeded();
  // Corrupt the middle chat's JSON, the way a truncated write would.
  store.db.prepare("UPDATE app_chats SET data = ? WHERE id = ?").run("{not json", "c2");

  const state = store.getAppState();

  assert.deepEqual(state.chats.map((c) => c.id), ["c1", "c3"],
    "the unreadable row drops out");
  const third = state.chats.find((c) => c.id === "c3");
  assert.equal(third.messages[0].content, "third",
    "c3 must keep its own messages — indexing by filtered position gave it c2's once");
});

test("a corrupted message row does not take the chat with it", () => {
  const store = seeded();
  store.db.prepare("UPDATE app_messages SET data = ? WHERE chat_id = ?").run("{not json", "c2");

  const state = store.getAppState();

  assert.deepEqual(state.chats.map((c) => c.id), ["c1", "c2", "c3"], "the chat survives");
  assert.deepEqual(state.chats.find((c) => c.id === "c2").messages, [],
    "and comes back with no messages rather than a crash");
});

test("replaceAppState leaves the singletons alone when they are omitted", () => {
  const store = seeded();
  store.replaceAppState({
    characters: [], personas: [], lorebooks: [], scenarios: [], presets: [], chats: [],
    defaultPresetId: "p1", globalInstructions: { style: "terse" },
  });

  store.replaceAppState({
    characters: [], personas: [], lorebooks: [], scenarios: [], presets: [], chats: [],
  });

  const state = store.getAppState();
  assert.equal(state.defaultPresetId, "p1", "undefined means leave as-is, not clear");
  assert.deepEqual(state.globalInstructions, { style: "terse" });
});

// ─── Row mappers ──────────────────────────────────────────────────────────────

test("a JSON array column that will not parse becomes an empty list", () => {
  const card = rowToMemoryCard({
    id: 1, title: "t", content: "c", tags: "{not json", entity_ids: null,
    importance: 0.5, created_at: 0, updated_at: 0,
  });

  assert.deepEqual(card.tags, [], "one corrupted row must not fail the whole read");
  assert.deepEqual(card.entityIds, []);
});

test("a JSON column holding something that is not an array is refused too", () => {
  const card = rowToMemoryCard({
    id: 1, title: "t", content: "c", tags: '"episode"', entity_ids: "{}",
    importance: 0.5, created_at: 0, updated_at: 0,
  });

  assert.deepEqual(card.tags, [], "a bare string is not a tag list");
  assert.deepEqual(card.entityIds, []);
});

test("nullable columns arrive as null rather than undefined", () => {
  const fact = rowToFact({
    id: 1, subject_id: "ash", predicate: "fears", object_id: null, object_literal: "water",
    t_valid_start: 0, t_valid_end: null, t_ingested: 0,
    confidence: 1, importance: null, known_to: null, superseded_by: null,
  });

  assert.equal(fact.objectId, null);
  assert.equal(fact.supersededBy, null);
  assert.deepEqual(fact.knownTo, []);

  // description is the exception and deliberately so: it is rendered, and an
  // empty string is what the UI wants rather than a null it has to guard.
  const entity = rowToEntity({ id: "ash", type: "character", name: "Ash", description: null, created_at: 0 });
  assert.equal(entity.description, "");

  const commitment = rowToCommitment({
    id: 1, promisor_id: "ash", promisee_id: null, description: "d",
    status: "active", created_at: 0, resolved_at: null,
  });
  assert.equal(commitment.promiseeId, null);
  assert.equal(commitment.resolvedAt, null);
});

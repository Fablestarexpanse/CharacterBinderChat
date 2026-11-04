// User curation of facts: edit, pin, lock. The lock exists for one reason — a
// model's later guess must not overwrite what the user corrected — so most of
// these assert the ways that could silently fail.

import { test } from "node:test";
import assert from "node:assert/strict";

const { FableStore } = await import("../../lib/db/store.ts");
const { retrieveFactsForPrompt } = await import("../../lib/server/retrieval.ts");

const CHAT = "t";
function store() {
  const s = new FableStore(":memory:");
  for (const id of ["char-ash", "player"]) s.ensureEntity(CHAT, id, "character", id);
  return s;
}
const live = (s, subject = "char-ash") => s.queryFacts(CHAT, subject);

test("a locked single-valued fact is not replaced by automatic extraction", () => {
  const s = store();
  const { factId } = s.assertFact(CHAT, { subjectId: "char-ash", predicate: "lives_in", objectLiteral: "Oak" });
  s.updateFact(CHAT, factId, { locked: true });

  const r = s.assertFact(CHAT, { subjectId: "char-ash", predicate: "lives_in", objectLiteral: "Birch" });

  assert.equal(r.blockedByLock, true);
  assert.equal(r.duplicate, true, "reported as a duplicate so the extractor skips it like a repeat");
  assert.equal(r.factId, factId);
  assert.deepEqual(live(s).map((f) => f.objectLiteral), ["Oak"], "nothing was written");
});

test("an unlocked fact is still replaced as before", () => {
  const s = store();
  s.assertFact(CHAT, { subjectId: "char-ash", predicate: "lives_in", objectLiteral: "Oak" });
  s.assertFact(CHAT, { subjectId: "char-ash", predicate: "lives_in", objectLiteral: "Birch" });
  assert.deepEqual(live(s).map((f) => f.objectLiteral), ["Birch"]);
});

test("a hand-entered fact overrules a lock", () => {
  const s = store();
  const { factId } = s.assertFact(CHAT, { subjectId: "char-ash", predicate: "lives_in", objectLiteral: "Oak" });
  s.updateFact(CHAT, factId, { locked: true });
  s.assertFact(CHAT, { subjectId: "char-ash", predicate: "lives_in", objectLiteral: "Birch", respectLocks: false });
  assert.deepEqual(live(s).map((f) => f.objectLiteral), ["Birch"], "the user is the one overruling");
});

test("supersedeFact leaves a locked fact open unless forced", () => {
  const s = store();
  const a = s.assertFact(CHAT, { subjectId: "char-ash", predicate: "likes", objectLiteral: "tea" }).factId;
  const b = s.assertFact(CHAT, { subjectId: "char-ash", predicate: "likes", objectLiteral: "coffee" }).factId;
  s.updateFact(CHAT, a, { locked: true });
  s.supersedeFact(CHAT, a, b);   // e.g. the semantic-dedupe path
  assert.ok(live(s).some((f) => f.id === a), "still live");
  s.supersedeFact(CHAT, a, b, undefined, true);
  assert.ok(!live(s).some((f) => f.id === a), "forced");
});

test("editing the wording locks the fact, ranks it up and clears the stale embedding", () => {
  const s = store();
  const { factId } = s.assertFact(CHAT, { subjectId: "char-ash", predicate: "likes", objectLiteral: "tea", importance: 0.3 });
  s.setFactEmbedding(CHAT, factId, Buffer.from(new Float32Array([1, 0]).buffer));

  const r = s.updateFact(CHAT, factId, { objectLiteral: "  green tea " });

  assert.ok(r.ok);
  assert.equal(r.fact.objectLiteral, "green tea", "trimmed");
  assert.equal(r.fact.locked, true);
  assert.ok(r.fact.importance >= 0.8);
  assert.equal(s.getFactEmbedding(CHAT, factId), null, "the vector described the old wording");
});

test("editing can be saved without locking when the caller says so", () => {
  const s = store();
  const { factId } = s.assertFact(CHAT, { subjectId: "char-ash", predicate: "likes", objectLiteral: "tea" });
  const r = s.updateFact(CHAT, factId, { objectLiteral: "coffee", locked: false });
  assert.equal(r.fact.locked, false);
});

test("pin and lock alone do not touch the wording or the embedding", () => {
  const s = store();
  const { factId } = s.assertFact(CHAT, { subjectId: "char-ash", predicate: "likes", objectLiteral: "tea", importance: 0.3 });
  s.setFactEmbedding(CHAT, factId, Buffer.from(new Float32Array([1, 0]).buffer));
  const r = s.updateFact(CHAT, factId, { pinned: true });
  assert.equal(r.fact.pinned, true);
  assert.equal(r.fact.locked, false);
  assert.equal(r.fact.importance, 0.3);
  assert.ok(s.getFactEmbedding(CHAT, factId), "embedding kept");
});

test("invalid edits are refused with a reason", () => {
  const s = store();
  s.ensureEntity(CHAT, "harbor", "place", "Harbor");
  const lit = s.assertFact(CHAT, { subjectId: "char-ash", predicate: "likes", objectLiteral: "tea" }).factId;
  const ent = s.assertFact(CHAT, { subjectId: "char-ash", predicate: "visits", objectId: "harbor" }).factId;

  assert.equal(s.updateFact(CHAT, 9999, { pinned: true }).ok, false);
  assert.match(s.updateFact(CHAT, ent, { objectLiteral: "x" }).error, /entity/);
  assert.match(s.updateFact(CHAT, lit, { objectLiteral: "   " }).error, /empty/);
  assert.equal(s.updateFact("other-chat", lit, { pinned: true }).ok, false, "scoped to its chat");
});

test("a pinned fact is injected even when nothing about the conversation matches it", () => {
  const s = store();
  // Enough competing, higher-importance facts to crowd a small window
  for (let i = 0; i < 12; i++) {
    s.assertFact(CHAT, { subjectId: "char-ash", predicate: `noted_${i}`, objectLiteral: `thing ${i}`, importance: 0.9 });
  }
  const trivia = s.assertFact(CHAT, { subjectId: "char-ash", predicate: "noted_trivia", objectLiteral: "the rain smells of iron", importance: 0.05 }).factId;

  const without = retrieveFactsForPrompt(s, CHAT, "char-ash", { limit: 6, context: "completely unrelated" });
  assert.ok(!without.some((l) => l.includes("rain smells of iron")), "control: crowded out when not pinned");

  s.updateFact(CHAT, trivia, { pinned: true });
  const withPin = retrieveFactsForPrompt(s, CHAT, "char-ash", { limit: 6, context: "completely unrelated" });
  assert.ok(withPin.some((l) => l.includes("rain smells of iron")));
  assert.equal(withPin.length, 6, "the window size is unchanged");
});

test("pins are capped so they cannot starve the rest of the prompt", () => {
  const s = store();
  for (let i = 0; i < 10; i++) {
    const id = s.assertFact(CHAT, { subjectId: "char-ash", predicate: `pinned_${i}`, objectLiteral: `p${i}` }).factId;
    s.updateFact(CHAT, id, { pinned: true });
  }
  s.assertFact(CHAT, { subjectId: "player", predicate: "owns", objectLiteral: "a courier bike", importance: 0.9 });
  const lines = retrieveFactsForPrompt(s, CHAT, "char-ash", { limit: 8 });
  assert.equal(lines.length, 8);
  assert.ok(lines.some((l) => l.includes("courier bike")), "ten pins did not crowd out everyone else");
});

test("pinned and locked survive a branch and a transfer", () => {
  const s = store();
  const id = s.assertFact(CHAT, { subjectId: "char-ash", predicate: "likes", objectLiteral: "tea" }).factId;
  s.updateFact(CHAT, id, { pinned: true, locked: true });
  s.branchMemory({ fromChatId: CHAT, toChatId: "b", keptMessageIds: [], fallbackCutoff: null, messageIdMap: {} });
  s.transferMemory(CHAT, "x");
  for (const chat of ["b", "x"]) {
    const f = s.queryFacts(chat, "char-ash")[0];
    assert.equal(f.pinned, true, `${chat} pinned`);
    assert.equal(f.locked, true, `${chat} locked`);
  }
});

// What reaches the prompt, and in what order. A false green already happened
// here: retrieval considered only facts whose subject or object was the
// character, so everything the player said about themselves was unreachable —
// the character could not remember your sister. The contract below is what
// that fix put in place.

import { test } from "node:test";
import assert from "node:assert/strict";

const { FableStore } = await import("../../lib/db/store.ts");
const { retrieveFactsForPrompt } = await import("../../lib/server/retrieval.ts");

const CHAT = "t";
const CHAR = "char-ash";

function seed() {
  const store = new FableStore(":memory:");
  for (const id of [CHAR, "player", "kael", "harbor"]) {
    store.ensureEntity(CHAT, id, "character", id);
  }
  const fact = (subjectId, predicate, objectLiteral, extra = {}) =>
    store.assertFact(CHAT, { subjectId, predicate, objectLiteral, confidence: 0.9, importance: 0.5, ...extra });

  fact(CHAR, "sister", "Lila");             // identity-core, about the character
  fact("player", "fears", "deep water");    // identity-core, about the player
  fact(CHAR, "achieved", "a personal best");
  fact("player", "owns", "a courier bike");
  fact("kael", "located_at", "the harbor");  // world: neither participant
  fact("kael", "carries", "a stopwatch");
  return store;
}

test("identity-core facts about either participant are always retrieved", () => {
  const out = retrieveFactsForPrompt(seed(), CHAT, CHAR, { limit: 4 });
  assert.ok(out.some((l) => l.includes("Lila")), "the character's sister must survive the window");
  assert.ok(out.some((l) => l.includes("deep water")), "the player's fear must survive the window");
});

test("both participants get a share; world facts fill what is left", () => {
  const out = retrieveFactsForPrompt(seed(), CHAT, CHAR, { limit: 20 });
  assert.ok(out.some((l) => l.startsWith(CHAR)), "nothing about the character");
  assert.ok(out.some((l) => l.startsWith("player")), "nothing about the player");
  assert.ok(out.some((l) => l.startsWith("kael")), "world facts should backfill the unused room");
});

test("the limit is honoured", () => {
  const out = retrieveFactsForPrompt(seed(), CHAT, CHAR, { limit: 3 });
  assert.equal(out.length, 3);
});

test("witness scoping hides what a character was not present for", () => {
  const store = seed();
  store.ensureEntity(CHAT, "vex", "character", "vex");
  store.assertFact(CHAT, {
    subjectId: "player", predicate: "confided", objectLiteral: "a secret",
    knownTo: ["vex"],   // Ash was not in the scene
  });
  const ash = retrieveFactsForPrompt(store, CHAT, CHAR, { limit: 20 });
  const vex = retrieveFactsForPrompt(store, CHAT, "vex", { limit: 20 });
  assert.equal(ash.some((l) => l.includes("a secret")), false, "Ash must not remember what he did not witness");
  assert.ok(vex.some((l) => l.includes("a secret")), "Vex was there and should remember");
});

test("context reorders the facts that compete on relevance", () => {
  // Identity-core facts bypass relevance entirely — that is the point of
  // pinning — so the steer shows among the world facts, which do compete.
  const store = new FableStore(":memory:");
  for (const id of [CHAR, "player", "kael", "vex"]) store.ensureEntity(CHAT, id, "character", id);
  const fact = (s, p, o) =>
    store.assertFact(CHAT, { subjectId: s, predicate: p, objectLiteral: o, confidence: 0.9, importance: 0.5 });
  fact("kael", "carries", "a stopwatch");
  fact("vex", "sells", "fresh bread");

  const neutral = retrieveFactsForPrompt(store, CHAT, CHAR, { limit: 2 });
  const steered = retrieveFactsForPrompt(store, CHAT, CHAR, { limit: 2, context: "she sells fresh bread at the market" });
  assert.match(neutral[0], /stopwatch/);       // insertion order, nothing to prefer
  assert.match(steered[0], /fresh bread/);     // the exchange pulled it up
});

// The gate may only ever DELAY extraction, never lose it, and must not fire on
// anything that could hold a fact. These pin both halves.

import { test } from "node:test";
import assert from "node:assert/strict";

const { isTrivialExchange, createGate, MAX_CONSECUTIVE_SKIPS, contentWords } =
  await import("../../lib/chat/extractionGate.ts");

test("filler is trivial", () => {
  assert.equal(isTrivialExchange("ok", "*nods*"), true);
  assert.equal(isTrivialExchange("thanks!", "Anytime."), true);
  assert.equal(isTrivialExchange("hmm", "*smiles and says nothing*"), true);
});

test("anything with a fact-shaped tell is never trivial", () => {
  assert.equal(isTrivialExchange("ok", "Meet me at 9."), false, "a digit");
  assert.equal(isTrivialExchange("ok", "Tell Kael I said hi."), false, "a mid-sentence name");
  assert.equal(isTrivialExchange("I'm afraid of dogs, honestly, truly deeply", "Noted, carefully."), false, "enough content words");
});

test("a sentence-initial capital alone is not treated as a name", () => {
  assert.equal(isTrivialExchange("Yes.", "Okay."), true);
});

test("stopwords and filler do not count as content", () => {
  assert.deepEqual(contentWords("Oh, yeah, thanks lol"), []);
  assert.deepEqual(contentWords("The lighthouse keeper"), ["lighthouse", "keeper"]);
});

test("mode off never skips", () => {
  const g = createGate();
  for (let i = 0; i < 10; i++) assert.equal(g.shouldExtract("off", "ok", "ok"), true);
});

test("trivial mode skips, but never more than the cap in a row", () => {
  const g = createGate();
  const results = Array.from({ length: MAX_CONSECUTIVE_SKIPS + 2 }, () => g.shouldExtract("trivial", "ok", "ok"));
  assert.deepEqual(results, [...Array(MAX_CONSECUTIVE_SKIPS).fill(false), true, false],
    "after the cap it extracts once, then the count restarts");
});

test("a substantive exchange resets the skip count", () => {
  const g = createGate();
  g.shouldExtract("trivial", "ok", "ok");
  g.shouldExtract("trivial", "ok", "ok");
  assert.equal(g.shouldExtract("trivial", "My sister Elen moved to the capital last spring.", "I remember her."), true);
  assert.equal(g.shouldExtract("trivial", "ok", "ok"), false);
  assert.equal(g.shouldExtract("trivial", "ok", "ok"), false);
  assert.equal(g.shouldExtract("trivial", "ok", "ok"), false, "a full allowance again");
  assert.equal(g.shouldExtract("trivial", "ok", "ok"), true);
});

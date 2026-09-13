// Lexical overlap is the fallback wherever embeddings are unavailable, and the
// difference between its two scorers is load-bearing: jaccard for "are these
// the same promise", coverage for "does this longer text contain that
// fragment".

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./_load.mjs";

const { contentWords, normalizeText, jaccard, coverage } = await load("lib/text/overlap.ts");

test("content words drop punctuation and short filler", () => {
  assert.deepEqual([...contentWords("I will bring your shirt back!")].sort(),
    ["back", "bring", "shirt", "will", "your"]);
});

test("jaccard scores paraphrases high and unrelated text zero", () => {
  const a = contentWords("I will bring your shirt back tomorrow");
  assert.ok(jaccard(a, contentWords("bring the shirt back tomorrow")) >= 0.5);
  assert.equal(jaccard(a, contentWords("meet me at the docks")), 0);
});

test("an empty side scores zero rather than dividing by nothing", () => {
  assert.equal(jaccard(contentWords("Pip"), contentWords("Pip")), 0); // both too short
  assert.equal(coverage(contentWords(""), contentWords("anything at all")), 0);
});

test("coverage is asymmetric: a fragment inside a longer promise scores 1", () => {
  const fragment = contentWords("shirt back");
  const promise  = contentWords("I will bring your shirt back tomorrow after practice");
  assert.equal(coverage(fragment, promise), 1);
  assert.ok(jaccard(fragment, promise) < 1); // the symmetric score is not 1
});

test("normalizeText flattens punctuation and spacing for short strings", () => {
  assert.equal(normalizeText("  Pip!!  "), "pip");
  assert.equal(normalizeText("My-Chlorine"), "my chlorine");
});

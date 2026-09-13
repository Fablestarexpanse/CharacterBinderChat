// The predicate vocabulary is what makes supersession work: two spellings of
// "where they are" must collapse to one family, or the graph accumulates
// contradictions instead of replacing them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./_load.mjs";

const { normPredicate, predicateFamily, isSingleValued, isDurableFact, isIdentityCoreFact } =
  await load("lib/db/predicates.ts");

test("normPredicate canonicalises spelling and aliases", () => {
  assert.equal(normPredicate("Is Located At"), "located_at");
  assert.equal(normPredicate("located_in"), "located_at");
  assert.equal(normPredicate("resides_at"), "lives_at");
  assert.equal(normPredicate("fears"), "fears");
});

test("location spellings share one family", () => {
  const spellings = ["lives_at", "located_at", "current_location", "is_located_at", "based_at"];
  for (const p of spellings) assert.equal(predicateFamily(p), "location", p);
});

test("works_at is deliberately NOT in the location family", () => {
  // Where someone works and where they are are different questions; folding
  // them would supersede a job with a coffee shop.
  assert.notEqual(predicateFamily("works_at"), "location");
});

test("single-valued families supersede, multi-valued accumulate", () => {
  assert.equal(isSingleValued("current_location"), true);
  assert.equal(isSingleValued("knows"), false);
});

test("durable and identity-core predicates are recognised", () => {
  assert.equal(isDurableFact("fears"), true);
  assert.equal(isIdentityCoreFact("sister"), true);
  assert.equal(isIdentityCoreFact("ate_breakfast"), false);
});

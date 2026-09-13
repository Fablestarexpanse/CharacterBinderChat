// The Drawer 2 tables and guards. These look trivial, but two of them encode
// decisions that cost a soak run to find: "mood" is a readable stat and NOT a
// writable one (the extractor writing mood put a stray -11 in Drawer 1), and
// the guards are what stand between untrusted model output and a CHECK
// constraint violation, so they have to reject casing variants and non-strings
// rather than merely non-members.

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  STAT_NAMES, WRITABLE_STAT_NAMES, ENTITY_TYPES, DEFAULT_DECAY_RATES,
  isWritableStatName, isEntityType,
} = await import("../../lib/db/models.ts");

test("mood is readable but not writable", () => {
  assert.ok(STAT_NAMES.includes("mood"), "mood is one of the five axes the UI reads");
  assert.ok(!WRITABLE_STAT_NAMES.includes("mood"), "but the extractor must not write it");
  assert.equal(isWritableStatName("mood"), false);
});

test("every writable stat is also a readable stat", () => {
  for (const name of WRITABLE_STAT_NAMES) {
    assert.ok(STAT_NAMES.includes(name), `${name} must be readable too`);
  }
});

test("every stat name has a decay rate", () => {
  for (const name of STAT_NAMES) {
    assert.equal(typeof DEFAULT_DECAY_RATES[name], "number", `${name} needs a decay rate`);
  }
});

test("the stat guard rejects casing variants and non-strings", () => {
  assert.equal(isWritableStatName("trust"), true);
  assert.equal(isWritableStatName("Trust"), false);
  assert.equal(isWritableStatName("TRUST"), false);
  assert.equal(isWritableStatName(" trust"), false);
  assert.equal(isWritableStatName(null), false);
  assert.equal(isWritableStatName(undefined), false);
  assert.equal(isWritableStatName(42), false);
  assert.equal(isWritableStatName(["trust"]), false);
});

test("the entity guard rejects casing variants and non-strings", () => {
  for (const type of ENTITY_TYPES) assert.equal(isEntityType(type), true, type);
  assert.equal(isEntityType("Character"), false);
  assert.equal(isEntityType("person"), false);
  assert.equal(isEntityType(null), false);
  assert.equal(isEntityType(7), false);
});

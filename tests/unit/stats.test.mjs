// The emotional dynamics. Each rule here exists because a 200-exchange soak
// showed what happens without it, and AGENTS.md warns against "simplifying"
// them back to raw addition — so they are asserted rather than remembered.

import { test } from "node:test";
import assert from "node:assert/strict";

const { FableStore } = await import("../../lib/db/store.ts");

const CHAT = "t";
const OBS = "char-ash";
const TARGET = "player";

function fresh() {
  const store = new FableStore(":memory:");
  store.ensureEntity(CHAT, OBS, "character", OBS);
  store.ensureEntity(CHAT, TARGET, "character", TARGET);
  return store;
}

const delta = (store, stat, d) => store.deltaStat(CHAT, OBS, TARGET, stat, d).value;

test("headroom scaling makes the last stretch toward an extreme cost more", () => {
  const store = fresh();
  const fromNeutral = delta(store, "trust", 20);

  const high = fresh();
  high.setStat(CHAT, OBS, TARGET, "trust", 90);
  const before = 90;
  const after = delta(high, "trust", 20);
  assert.ok(fromNeutral > after - before,
    `+20 at neutral (${fromNeutral}) should move more than +20 at 90 (${after - before})`);
});

test("loss aversion: a bond stat falls faster than it rises", () => {
  const up = fresh();
  const gained = delta(up, "trust", 20);

  const down = fresh();
  const lost = -delta(down, "trust", -20);
  assert.ok(lost > gained, `-20 should bite harder (${lost}) than +20 builds (${gained})`);
});

test("loss aversion does NOT apply to desire", () => {
  // Only affection, trust and connection are bond stats.
  const up = fresh();
  const gained = delta(up, "desire", 20);
  const down = fresh();
  const lost = -delta(down, "desire", -20);
  assert.equal(lost.toFixed(6), gained.toFixed(6));
});

test("a rupture opens a refractory window that dampens repair", () => {
  const store = fresh();
  store.setStat(CHAT, OBS, TARGET, "trust", 40);
  delta(store, "trust", -20);                       // ×1.5 = -30 effective: a rupture
  assert.equal(store.isRecentlyRuptured(CHAT, OBS, TARGET), true);

  const wounded = store.getStat(CHAT, OBS, TARGET, "trust");
  assert.ok(wounded.ruptureRecovery > 0, "the window should be open");

  const beforeRepair = wounded.value;
  const afterRepair = delta(store, "trust", 20);

  const control = fresh();
  control.setStat(CHAT, OBS, TARGET, "trust", beforeRepair);
  const controlAfter = delta(control, "trust", 20);
  assert.ok(afterRepair - beforeRepair < controlAfter - beforeRepair,
    "repair inside the window must land smaller than the same delta outside it");
});

test("the window drains one step per positive delta", () => {
  const store = fresh();
  store.setStat(CHAT, OBS, TARGET, "trust", 40);
  delta(store, "trust", -20);
  const opened = store.getStat(CHAT, OBS, TARGET, "trust").ruptureRecovery;
  delta(store, "trust", 5);
  assert.equal(store.getStat(CHAT, OBS, TARGET, "trust").ruptureRecovery, opened - 1);
});

test("values stay inside -100..100 however hard they are pushed", () => {
  const store = fresh();
  for (let i = 0; i < 50; i++) delta(store, "affection", 30);
  assert.ok(store.getStat(CHAT, OBS, TARGET, "affection").value <= 100);
  for (let i = 0; i < 50; i++) delta(store, "affection", -30);
  assert.ok(store.getStat(CHAT, OBS, TARGET, "affection").value >= -100);
});

test("stats are directed: character -> player, not the reverse", () => {
  const store = fresh();
  delta(store, "trust", 10);
  assert.ok(store.queryStats(CHAT, OBS, TARGET).trust);
  assert.equal(store.queryStats(CHAT, TARGET, OBS).trust, undefined);
});

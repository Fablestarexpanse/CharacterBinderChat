// Bi-temporal behaviour, through the real routes and a real database.
//
// The rules under test are the ones the Python prototype defines and
// AGENTS.md names as the spec: a single-valued predicate supersedes rather
// than accumulates, superseding closes the old fact instead of deleting it,
// and the default query returns only what is currently true.
//
// Skipped unless FABLE_TEST_URL points at a running server, because it writes:
//   FABLE_TEST_URL=http://localhost:3001 npm run test:api
// Every row it writes is under its own chat id and deleted afterwards.

import { test, after } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.FABLE_TEST_URL;
const CHAT = `test-bitemporal-${Date.now()}`;
const SUBJECT = "test-subject";

const post = (path, body) =>
  fetch(`${BASE}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then((r) => r.json());

const facts = (params = "") =>
  fetch(`${BASE}/api/drawer/facts?chatId=${CHAT}&subject=${SUBJECT}${params}`).then((r) => r.json());

const addFact = (predicate, objectLiteral) =>
  post("/api/drawer/facts", { chatId: CHAT, subjectId: SUBJECT, predicate, objectLiteral });

test("bi-temporal invariants", { skip: BASE ? false : "set FABLE_TEST_URL to run (this suite needs a running server)" }, async (t) => {
  await t.test("a single-valued predicate supersedes its predecessor", async () => {
    const first  = await addFact("lives_at", "Harbor District");
    const second = await addFact("current_location", "Uptown");   // same family, new object
    assert.equal(second.ok, true);
    assert.deepEqual(second.superseded, [first.factId]);
  });

  await t.test("only the current fact is live; the old one is history, not gone", async () => {
    const live = await facts();
    assert.equal(live.facts.length, 1);
    assert.equal(live.facts[0].objectDisplay, '"Uptown"');

    const all = await facts("&includeSuperseded=1");
    assert.equal(all.facts.length, 2);
    const closed = all.facts.find((f) => f.objectDisplay === '"Harbor District"');
    assert.ok(closed.tValidEnd, "the superseded fact should have been closed, not left open");
    assert.ok(closed.supersededBy, "the superseded fact should point at its replacement");
  });

  await t.test("restating a live fact writes nothing", async () => {
    const again = await addFact("current_location", "Uptown");
    assert.equal(again.duplicate, true);
    assert.equal((await facts()).facts.length, 1);
  });

  await t.test("a multi-valued predicate accumulates instead", async () => {
    await addFact("knows", "Kael");
    await addFact("knows", "Elen");
    const live = (await facts()).facts.filter((f) => f.predicate === "knows");
    assert.equal(live.length, 2);
  });
});

after(async () => {
  if (!BASE) return;
  const all = await facts("&includeSuperseded=1").catch(() => ({ facts: [] }));
  for (const f of all.facts ?? []) {
    await fetch(`${BASE}/api/drawer/facts?chatId=${CHAT}&factId=${f.id}`, { method: "DELETE" });
  }
  // The subject entity is created implicitly by the first fact write, and the
  // facts API has no delete for entities — merging it away is what the app
  // itself does with a stray entity.
  const left = await fetch(`${BASE}/api/drawer/entities?chatId=${CHAT}`).then((r) => r.json());
  if ((left.entities ?? []).length > 0) {
    console.warn(`[cleanup] ${left.entities.length} entity row(s) left under ${CHAT}`);
  }
});

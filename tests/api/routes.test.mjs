// Route contracts, against a running server and a real database.
//
// These cover what the unit tests cannot: the request envelope, the status
// codes, the guards that protect the durable copy. Anything needing a model
// call is asserted up to the point of that call — the failure mode there is
// the provider being down, not the route being wrong.
//
//   FABLE_TEST_URL=http://localhost:3001 npm run test:api
//
// Writes live under a per-run chat id and are deleted afterwards.

import { test, after } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.FABLE_TEST_URL;
const CHAT = `test-routes-${Date.now()}`;
// Skipping when unset is deliberate — these need a server — but the runner
// exits 0 on an all-skipped file, so a typo'd URL would read as a pass. Naming
// it in the output is the difference between "not run" and "ran and passed".
const skip = BASE ? false : "set FABLE_TEST_URL to run (this suite needs a running server)";

const get  = (path) => fetch(`${BASE}${path}`).then(async (r) => ({ status: r.status, body: await r.json() }));
const send = (method, path, body) =>
  fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json() }));

test("every drawer read requires its chat scope", { skip }, async () => {
  for (const path of ["/api/drawer/entities", "/api/drawer/facts", "/api/drawer/stats", "/api/drawer/graph"]) {
    const { status, body } = await get(path);
    assert.equal(status, 400, `${path} should refuse an unscoped read`);
    assert.equal(body.ok, false);
    assert.match(body.error, /chatId/);
  }
});

test("entities: the type filter is validated on both read and write", { skip }, async () => {
  const bad = await get(`/api/drawer/entities?chatId=${CHAT}&type=sandwich`);
  assert.equal(bad.status, 400);
  assert.match(bad.error ?? bad.body.error, /type must be one of/);

  const created = await send("POST", "/api/drawer/entities",
    { chatId: CHAT, id: "test-place", type: "place", name: "The Docks" });
  assert.equal(created.body.ok, true);
  assert.equal(created.body.entity.type, "place");

  const listed = await get(`/api/drawer/entities?chatId=${CHAT}&type=place`);
  assert.equal(listed.body.entities.length, 1);
});

test("facts: numeric fields are range-checked, not trusted", { skip }, async () => {
  const base = { chatId: CHAT, subjectId: "test-subject", predicate: "likes" };
  for (const bad of [{ confidence: 5 }, { confidence: Number.NaN }, { importance: -1 }]) {
    const res = await send("POST", "/api/drawer/facts", { ...base, objectLiteral: "rain", ...bad });
    assert.equal(res.status, 400, `should refuse ${JSON.stringify(bad)}`);
  }
});

test("facts: an object entity that does not exist is a 400, not an SQL 500", { skip }, async () => {
  const res = await send("POST", "/api/drawer/facts",
    { chatId: CHAT, subjectId: "test-subject", predicate: "knows", objectId: "nobody-here" });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /does not exist/);
});

test("memory-task routes share one envelope validator", { skip }, async () => {
  const routes = ["/api/drawer/extract", "/api/drawer/episode", "/api/chat/core-memory/refresh"];
  const body = {
    chatId: CHAT, characterId: "test-subject", modelId: "m", providerType: "ollama",
    messages: [{ role: "user", content: "hi" }],
  };
  for (const path of routes) {
    const badScheme = await send("POST", path, { ...body, providerBaseUrl: "ftp://nope" });
    assert.equal(badScheme.body.error, "providerBaseUrl must be an http(s) URL", path);

    const badProvider = await send("POST", path,
      { ...body, providerBaseUrl: "http://localhost:11434", providerType: "not-a-provider" });
    assert.match(badProvider.body.error, /providerType must be one of/, path);
  }
});

test("core-memory: created on demand, and PATCH whitelists what it merges", { skip }, async () => {
  const created = await get(
    `/api/chat/core-memory?chatId=${CHAT}&characterId=test-subject&name=Tester`);
  assert.equal(created.status, 200);
  assert.equal(created.body.coreMemory.characterId, "test-subject");
  assert.ok(Array.isArray(created.body.knownFacts));

  const patched = await send("PATCH", "/api/chat/core-memory", {
    chatId: CHAT, characterId: "test-subject",
    narrative_summary: "They met at the docks.",
  });
  assert.equal(patched.body.ok, true);
  assert.equal(patched.body.coreMemory.narrative_summary, "They met at the docks.");

  // The patch is spread into the stored document, so an unknown key is
  // refused outright rather than dropped — a typo'd field name should fail
  // loudly, not vanish.
  const unknown = await send("PATCH", "/api/chat/core-memory",
    { chatId: CHAT, characterId: "test-subject", nonsense_field: "should not be stored" });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /unknown field/);
});

test("core-memory: a value of the wrong shape is refused", { skip }, async () => {
  const res = await send("PATCH", "/api/chat/core-memory",
    { chatId: CHAT, characterId: "test-subject", mood: null });
  assert.equal(res.status, 400);
});

test("state: the durable copy refuses a payload that would wipe it", { skip }, async () => {
  const before = await get("/api/state");
  assert.equal(before.status, 200);

  const missing = await send("PUT", "/api/state", { chats: [] });
  assert.equal(missing.status, 400);

  // The guard fires at 3+ existing rows, so this seeds its own rows rather
  // than asserting only when the developer's database happens to hold enough —
  // a test that passes by luck is worse than no test. Scenarios are used
  // because they are an ordinary collection with no other machinery attached.
  const seeded = [1, 2, 3].map((n) => ({
    id: `test-scenario-${n}`, name: `probe ${n}`, scenario: "x",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }));
  const withSeed = { ...before.body, scenarios: [...before.body.scenarios, ...seeded] };

  try {
    assert.equal((await send("PUT", "/api/state", withSeed)).status, 200);

    const wipe = await send("PUT", "/api/state", { ...withSeed, scenarios: [] });
    assert.equal(wipe.status, 409, "wiping a populated collection must be refused");
    assert.match(wipe.body.error, /refusing to wipe all scenarios/);
  } finally {
    // Removing them the way the guard's own error message says to: one at a
    // time. A bulk restore would itself be refused, which is how this test
    // first learned the guard works.
    for (let n = seeded.length - 1; n >= 0; n--) {
      await send("PUT", "/api/state", {
        ...withSeed,
        scenarios: [...before.body.scenarios, ...seeded.slice(0, n)],
      });
    }
  }

  const after = await get("/api/state");
  assert.equal(after.body.characters.length, before.body.characters.length);
  assert.equal(after.body.scenarios.length, before.body.scenarios.length,
    "the durable copy must be left exactly as it was found");
});

test("workflows: the catalogue reads without a chat scope", { skip }, async () => {
  const { status, body } = await get("/api/workflows");
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.workflows));
});

test("scene-prompt: required fields and the URL guard", { skip }, async () => {
  const missing = await send("POST", "/api/image/scene-prompt", { messages: [] });
  assert.equal(missing.status, 400);

  const badUrl = await send("POST", "/api/image/scene-prompt",
    { messages: [{ role: "user", content: "hi" }], ollamaBaseUrl: "ftp://nope", modelId: "m" });
  assert.equal(badUrl.body.error, "ollamaBaseUrl must be an http(s) URL");
});

after(async () => {
  if (!BASE) return;
  const facts = await get(`/api/drawer/facts?chatId=${CHAT}&subject=test-subject&includeSuperseded=1`)
    .catch(() => ({ body: { facts: [] } }));
  for (const f of facts.body.facts ?? []) {
    await fetch(`${BASE}/api/drawer/facts?chatId=${CHAT}&factId=${f.id}`, { method: "DELETE" });
  }
});

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

test("state PATCH: malformed patches are refused before anything is written", { skip }, async () => {
  const unknown = await send("PATCH", "/api/state", { upserts: { widgets: [{ id: "x" }] } });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /unknown collection/);

  const noId = await send("PATCH", "/api/state", { upserts: { chats: [{ messages: [] }] } });
  assert.equal(noId.status, 400);

  const notArray = await send("PATCH", "/api/state", { removals: { chats: "c1" } });
  assert.equal(notArray.status, 400);

  const badOrder = await send("PATCH", "/api/state", { order: { chats: [1, 2] } });
  assert.equal(badOrder.status, 400);
});

test("state PATCH: an empty patch is accepted and changes nothing", { skip }, async () => {
  const before = await get("/api/state");
  const res = await send("PATCH", "/api/state", {});
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  const after = await get("/api/state");
  assert.equal(after.body.chats.length, before.body.chats.length);
});

test("branch: malformed requests are refused before anything is written", { skip }, async () => {
  const noSource = await send("POST", "/api/drawer/branch", { chat: { id: "x", messages: [] } });
  assert.equal(noSource.status, 400);
  const sameId = await send("POST", "/api/drawer/branch", {
    sourceChatId: "a", chat: { id: "a", messages: [] }, keptMessageIds: [], messageIdMap: {}, fallbackCutoff: null,
  });
  assert.equal(sameId.status, 400);
  const badCutoff = await send("POST", "/api/drawer/branch", {
    sourceChatId: "a", chat: { id: "b", messages: [] }, keptMessageIds: [], messageIdMap: {}, fallbackCutoff: "soon",
  });
  assert.equal(badCutoff.status, 400);
  const snap = await send("POST", "/api/drawer/snapshot", { chatId: "a" });
  assert.equal(snap.status, 400);
});

// ─── Backup and restore: only the non-destructive paths are exercised here ───

test("backup: the download is a real SQLite file, named by date, with no API keys in it", { skip }, async () => {
  const res = await fetch(`${BASE}/api/backup`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /fablechat-backup-\d{4}-\d{2}-\d{2}\.db/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 15).toString("latin1"), "SQLite format 3");
  assert.ok(!buf.toString("latin1").includes("secret:"), "no stored keys");
});

test("restore: a file that is not a backup is refused at staging, with a reason", { skip }, async () => {
  const res = await fetch(`${BASE}/api/backup/restore?stage=1`, { method: "POST", body: Buffer.from("not a database ".repeat(100)) });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /not a database file/);
});

test("restore: nothing is replaced without the confirmation header and a valid token", { skip }, async () => {
  const before = await get("/api/state");
  const noHeader = await send("POST", "/api/backup/restore", { token: "0".repeat(32) });
  assert.equal(noHeader.status, 400);
  assert.match(noHeader.body.error, /X-Confirm-Restore/);

  const badToken = await fetch(`${BASE}/api/backup/restore`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Confirm-Restore": "replace-everything" }, body: JSON.stringify({ token: "../../etc/passwd" }),
  });
  assert.equal(badToken.status, 400, "a path-shaped token is not accepted");

  const expired = await fetch(`${BASE}/api/backup/restore`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Confirm-Restore": "replace-everything" }, body: JSON.stringify({ token: "a".repeat(32) }),
  });
  assert.equal(expired.status, 400);
  assert.match((await expired.json()).error, /expired/);

  const after = await get("/api/state");
  assert.equal(after.body.chats.length, before.body.chats.length, "the database was not touched");
});

test("state: responses carry an epoch, and it is stable between calls", { skip }, async () => {
  const a = await get("/api/state"), b = await get("/api/state");
  assert.equal(typeof a.body.epoch, "string");
  assert.equal(a.body.epoch, b.body.epoch);
  assert.equal((await get("/api/state/changes?since=0")).body.epoch, a.body.epoch);
});

// ─── Assets ──────────────────────────────────────────────────────────────────
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=", "base64");

test("assets: an image uploads, dedupes, and is served with safe headers; junk is refused", { skip }, async () => {
  const up = async (body) => { const r = await fetch(`${BASE}/api/assets`, { method: "POST", body }); return { status: r.status, body: await r.json() }; };
  const a = await up(TINY_PNG), b = await up(TINY_PNG);
  assert.equal(a.status, 200);
  assert.match(a.body.url, /^\/api\/assets\/[0-9a-f]{64}$/);
  assert.equal(a.body.url, b.body.url, "same bytes, same asset");

  const svg = await up(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"));
  assert.equal(svg.status, 400);
  assert.match(svg.body.error, /not an image/);

  const got = await fetch(`${BASE}${a.body.url}`);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("content-type"), "image/png");
  assert.equal(got.headers.get("x-content-type-options"), "nosniff");
  assert.match(got.headers.get("cache-control"), /immutable/);
  assert.equal((await fetch(`${BASE}/api/assets/${"0".repeat(64)}`)).status, 404);
  assert.equal((await fetch(`${BASE}${a.body.url}?w=64`)).status, 200, "a sized copy (or the original) is served");
});

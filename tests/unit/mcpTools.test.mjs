// The MCP tools with a fake HTTP layer: they must send the right requests and, more
// importantly, turn failures into messages an agent can act on.

import { test } from "node:test";
import assert from "node:assert/strict";

const { buildTools, makeCall } = await import("../../mcp/tools.mjs");

function harness(responder = () => ({ ok: true })) {
  const calls = [];
  const call = async (method, path, body) => { calls.push({ method, path, body }); return responder(method, path, body); };
  const tools = Object.fromEntries(buildTools(call).map((t) => [t.name, t]));
  return { calls, tools };
}

test("every tool has a name, description, schema and annotations", () => {
  const { tools } = harness();
  assert.deepEqual(Object.keys(tools).sort(), [
    "app_status", "create_character", "create_lorebook", "create_persona", "create_scenario",
    "delete_card", "get_card", "list_cards", "parse_card_text", "set_avatar", "undo_change", "update_card",
  ]);
  for (const t of Object.values(tools)) {
    assert.ok(t.description.length > 20, t.name);
    assert.ok(t.annotations && typeof t.annotations.readOnlyHint === "boolean", t.name);
  }
});

test("read tools are marked read-only; delete, update and undo are marked destructive", () => {
  const { tools } = harness();
  for (const n of ["app_status", "list_cards", "get_card", "parse_card_text"]) assert.equal(tools[n].annotations.readOnlyHint, true, n);
  for (const n of ["update_card", "delete_card", "undo_change", "set_avatar"]) assert.equal(tools[n].annotations.destructiveHint, true, n);
  for (const n of ["create_character", "create_lorebook"]) assert.equal(tools[n].annotations.destructiveHint, false, n);
});

test("create_character wraps fields in a V2 card, and a lorebook becomes an embedded character_book", async () => {
  const { calls, tools } = harness();
  await tools.create_character.handler({
    name: "Ash", description: "A courier.", first_mes: "Hi.",
    lorebook: { entries: [{ keys: ["harbor"], content: "Gulls.", selective: true, secondary_keys: ["night"] }] },
  });
  const { method, path, body } = calls[0];
  assert.equal(`${method} ${path}`, "POST /api/cards/character");
  assert.equal(body.card.spec, "chara_card_v2");
  assert.equal(body.card.data.first_mes, "Hi.");
  const book = body.card.data.character_book;
  assert.equal(book.name, "Ash's world", "a default lorebook name");
  assert.equal(book.entries[0].enabled, true, "entries default to enabled");
  assert.deepEqual(book.entries[0].secondary_keys, ["night"]);
  assert.equal("lorebook" in body.card.data, false, "the helper field does not leak into the card");
});

test("create_character without a lorebook sends no character_book", async () => {
  const { calls, tools } = harness();
  await tools.create_character.handler({ name: "A", description: "d" });
  assert.equal("character_book" in calls[0].body.card.data, false);
});

test("persona and scenario tools set the right spec", async () => {
  const { calls, tools } = harness();
  await tools.create_persona.handler({ name: "Kira", description: "d" });
  await tools.create_scenario.handler({ name: "Storm", scenario: "A gale.", first_mes: "Thunder." });
  assert.equal(calls[0].body.card.spec, "persona_card_v1");
  assert.equal(calls[1].body.card.spec, "scenario_card_v1");
  assert.equal(calls[1].body.card.first_mes, "Thunder.");
});

test("ids with unusual characters are encoded in the URL", async () => {
  const { calls, tools } = harness();
  await tools.get_card.handler({ type: "character", id: "a/b c?d" });
  assert.equal(calls[0].path, "/api/cards/character/a%2Fb%20c%3Fd");
});

test("update, delete and undo hit the right routes", async () => {
  const { calls, tools } = harness();
  await tools.update_card.handler({ type: "persona", id: "p", changes: { description: "x" } });
  await tools.delete_card.handler({ type: "persona", id: "p" });
  await tools.undo_change.handler({ historyId: 7 });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["PATCH /api/cards/persona/p", "DELETE /api/cards/persona/p", "POST /api/cards/undo"]);
  assert.deepEqual(calls[0].body, { changes: { description: "x" } });
  assert.deepEqual(calls[2].body, { historyId: 7 });
});

test("app_status reports counts for every kind", async () => {
  const { tools } = harness((m, path) => path.startsWith("/api/cards") ? { cards: [1, 2] } : { rev: 9 });
  assert.deepEqual(await tools.app_status.handler({}), { reachable: true, revision: 9, cards: { character: 2, lorebook: 2, persona: 2, scenario: 2 } });
});

// ─── makeCall: errors an agent can act on ───────────────────────────────────
const json = (status, body) => ({ status, ok: status < 400, json: async () => body });
const caller = (fetchImpl, extra = {}) => makeCall({ baseUrl: "http://x:3000/", source: () => "Claude Code", fetchImpl, ...extra });

test("the server's own error message reaches the agent", async () => {
  const call = caller(async () => json(400, { ok: false, error: "Description is required" }));
  await assert.rejects(() => call("POST", "/api/cards/character", {}), /Description is required/);
});

test("an unreachable app says how to start it, not just ECONNREFUSED", async () => {
  const call = caller(async () => { const e = new Error("fetch failed"); e.cause = { code: "ECONNREFUSED" }; throw e; });
  await assert.rejects(() => call("GET", "/x"), /Is it running\?.*npm run dev.*ECONNREFUSED/);
});

test("a 401 says to set FABLE_PASSWORD", async () => {
  const call = caller(async () => json(401, { ok: false, error: "Authentication required" }));
  await assert.rejects(() => call("GET", "/x"), /FABLE_PASSWORD/);
});

test("requests carry the source label, JSON content type only with a body, and Basic auth when configured", async () => {
  let seen;
  const call = caller(async (url, init) => { seen = { url, ...init }; return json(200, { ok: true }); }, { password: "pw" });
  await call("POST", "/api/cards/undo", { historyId: 1 });
  assert.equal(seen.url, "http://x:3000/api/cards/undo", "trailing slash on the base is handled");
  assert.equal(seen.headers["X-Fable-Source"], "Claude Code");
  assert.equal(seen.headers["Content-Type"], "application/json");
  assert.equal(seen.headers.Authorization, `Basic ${Buffer.from("fable:pw").toString("base64")}`);
  await call("GET", "/x");
  assert.equal(seen.headers["Content-Type"], undefined);
  assert.equal(seen.body, undefined);
});

test("a non-JSON error body still yields a useful message", async () => {
  const call = caller(async () => ({ status: 502, ok: false, json: async () => { throw new Error("not json"); } }));
  await assert.rejects(() => call("GET", "/x"), /HTTP 502/);
});

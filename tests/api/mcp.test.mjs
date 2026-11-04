// The MCP server end to end: a real MCP client over stdio, the real server process,
// and a running FableChat. Proves the whole chain an agent uses, including that the
// card it creates is visible to the app's own sync endpoint.
//
//   FABLE_TEST_URL=http://localhost:3001 npm run test:api
//
// Cleans up after itself: everything it creates is deleted again.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const BASE = process.env.FABLE_TEST_URL;
const skip = BASE ? false : "set FABLE_TEST_URL to run (this suite needs a running server)";
const created = [];

let client;
async function connect() {
  if (client) return client;
  client = new Client({ name: "mcp-test-client", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: ["mcp/server.mjs"], env: { ...process.env, FABLE_URL: BASE },
  }));
  return client;
}
const run = async (name, args) => {
  const r = await (await connect()).callTool({ name, arguments: args });
  const text = r.content[0].text;
  return { isError: !!r.isError, text, json: r.isError ? null : JSON.parse(text) };
};

after(async () => {
  for (const [type, id] of created) await fetch(`${BASE}/api/cards/${type}/${id}`, { method: "DELETE" }).catch(() => {});
  await client?.close();
});

test("the server lists its tools", { skip }, async () => {
  const { tools } = await (await connect()).listTools();
  assert.ok(tools.length >= 10);
  assert.ok(tools.find((t) => t.name === "create_character").inputSchema.properties.description);
});

test("create, read, update, undo and delete a character through MCP", { skip }, async () => {
  const made = await run("create_character", { name: "MCP Probe", description: "Made by the MCP test.", first_mes: "Hi {{user}}." });
  assert.equal(made.isError, false, made.text);
  created.push(["character", made.json.id]);

  const listed = await run("list_cards", { type: "character" });
  assert.ok(listed.json.some((c) => c.id === made.json.id));

  const card = await run("get_card", { type: "character", id: made.json.id });
  assert.equal(card.json.data.first_mes, "Hi {{user}}.");

  // the app's own sync endpoint now reports it, attributed to the connecting client
  const ch = await (await fetch(`${BASE}/api/state/changes?since=${made.json.rev - 1}`)).json();
  assert.ok(ch.upserts.characters.some((r) => r.data.id === made.json.id));
  assert.ok(ch.events.some((e) => e.summary.includes("mcp-test-client created character")), "attributed to the MCP client by name");

  const upd = await run("update_card", { type: "character", id: made.json.id, changes: { personality: "curious" } });
  assert.equal(upd.isError, false, upd.text);
  assert.equal((await run("get_card", { type: "character", id: made.json.id })).json.data.personality, "curious");

  await run("undo_change", { historyId: upd.json.historyId });
  assert.equal((await run("get_card", { type: "character", id: made.json.id })).json.data.personality, "");

  const del = await run("delete_card", { type: "character", id: made.json.id });
  assert.equal(del.isError, false);
  assert.equal((await run("get_card", { type: "character", id: made.json.id })).isError, true);
  await run("undo_change", { historyId: del.json.historyId });
  assert.equal((await run("get_card", { type: "character", id: made.json.id })).isError, false, "the delete was reversible");
});

test("failures come back as tool errors an agent can read, not protocol errors", { skip }, async () => {
  const bad = await run("create_character", { name: "No description", description: "" });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /Description is required/);

  const typo = await run("update_card", { type: "character", id: "does-not-exist", changes: { name: "x" } });
  assert.equal(typo.isError, true);
  assert.match(typo.text, /not found/);
});

test("set_avatar gives a character a picture from a file, and it can be undone", { skip }, async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mcp-avatar-")), "a.png");
  fs.writeFileSync(file, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=", "base64"));
  const made = await run("create_character", { name: "MCP Avatar Probe", description: "Gets a picture." });
  created.push(["character", made.json.id]);

  const set = await run("set_avatar", { type: "character", id: made.json.id, path: file });
  assert.equal(set.isError, false, set.text);
  assert.match(set.json.avatar, /^\/api\/assets\//);
  assert.equal((await fetch(`${BASE}${set.json.avatar}`)).status, 200);

  const relative = await run("set_avatar", { type: "character", id: made.json.id, path: "a.png" });
  assert.equal(relative.isError, true, "relative paths are refused");
  const missing = await run("set_avatar", { type: "character", id: made.json.id, path: "/no/such/file.png" });
  assert.match(missing.text, /Could not read/);

  await run("undo_change", { historyId: set.json.historyId });
  const st = await (await fetch(`${BASE}/api/state`)).json();
  assert.equal(st.characters.find((c) => c.id === made.json.id).avatar, undefined);
});

test("a lorebook created with a character is linked, and parse_card_text sorts pasted text", { skip }, async () => {
  const made = await run("create_character", {
    name: "MCP Lore Probe", description: "Has a world.",
    lorebook: { entries: [{ keys: ["harbor"], content: "Gulls wheel overhead." }] },
  });
  assert.equal(made.isError, false, made.text);
  created.push(["character", made.json.id]);
  const card = await run("get_card", { type: "character", id: made.json.id });
  assert.equal(card.json.data.character_book.entries[0].keys[0], "harbor");
  const books = await run("list_cards", { type: "lorebook" });
  for (const b of books.json.filter((b) => b.name === "MCP Lore Probe's world")) created.push(["lorebook", b.id]);

  const parsed = await run("parse_card_text", { text: "Name: Mira\nPersonality: stoic" });
  assert.equal(parsed.json.fields.name, "Mira");
});

// The background model: memory and image prompts run on a local model, and the
// chat's own (maybe paid) model only when you allowed it.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fable-bg-"));
process.env.FABLE_DB_PATH = path.join(dir, "t.db");
const B = await import("../../lib/server/backgroundModel.ts");
const { closeStore } = await import("../../lib/db/index.ts");
after(() => { closeStore(); fs.rmSync(dir, { recursive: true, force: true }); });

// Not on this computer, so nothing is ever started; only the stubbed answers matter
const OLLAMA = "http://ollama.test:11434";
const chat = { providerType: "openrouter", providerBaseUrl: "https://openrouter.ai/api", modelId: "anthropic/x", apiKey: "k" };
const realFetch = globalThis.fetch;
const ollamaHas = (models) => { globalThis.fetch = async (url) => String(url).endsWith("/api/tags")
  ? new Response(JSON.stringify({ models: models.map((name) => ({ name })) }))
  : new Response("{}", { status: 404 }); };
const ollamaDown = () => { globalThis.fetch = async () => { throw new TypeError("fetch failed"); }; };
after(() => { globalThis.fetch = realFetch; });

test("settings: only a true switch and a sane model name are kept", () => {
  assert.deepEqual(B.cleanBackground({}), { fallbackToChat: false });
  assert.deepEqual(B.cleanBackground({ fallbackToChat: "yes", ollamaModel: "rm -rf /;" }), { fallbackToChat: false });
  assert.deepEqual(B.cleanBackground({ fallbackToChat: true, ollamaModel: "qwen3:4b" }), { fallbackToChat: true, ollamaModel: "qwen3:4b" });
});

test("the memory model in Ollama is used, ahead of the utility model and the chat's model", async () => {
  B.setBackground({ fallbackToChat: true, ollamaModel: undefined });
  ollamaHas(["gpt-oss:20b", B.MEMORY_MODEL.id, "my-utility:latest"]);
  assert.deepEqual(await B.backgroundModel({ ollamaBaseUrl: OLLAMA, utilityModel: "my-utility" }, chat),
    { providerType: "ollama", providerBaseUrl: OLLAMA, modelId: B.MEMORY_MODEL.id });
  ollamaHas(["my-utility:latest"]);
  assert.equal((await B.backgroundModel({ ollamaBaseUrl: OLLAMA, utilityModel: "my-utility" }, chat)).modelId, "my-utility", "the chosen utility model, found under :latest");
});

test("no local model: the chat's model only when allowed, otherwise a reason that says what to do", async () => {
  ollamaHas(["gpt-oss:20b"]);
  B.setBackground({ fallbackToChat: false });
  await assert.rejects(B.backgroundModel({ ollamaBaseUrl: OLLAMA }, chat), (e) => e instanceof B.NoBackgroundModel
    && /no memory model/.test(e.message) && /Settings → Memory/.test(e.message) && /switched off/.test(e.message));
  B.setBackground({ fallbackToChat: true });
  assert.deepEqual(await B.backgroundModel({ ollamaBaseUrl: OLLAMA }, chat), chat, "allowed: the chat's model");
  ollamaDown();
  B.setBackground({ fallbackToChat: false });
  await assert.rejects(B.backgroundModel({ ollamaBaseUrl: OLLAMA }, chat), /No local model for memory/);
});

test("a memory route request is swapped onto the background model, or answered with the reason", async () => {
  ollamaHas([B.MEMORY_MODEL.id]);
  const task = { ...chat, chatId: "c", background: { ollamaBaseUrl: OLLAMA } };
  const v = await B.withBackground(task);
  assert.equal(v.providerType, "ollama");
  assert.equal(v.chatId, "c", "everything else in the request is kept");
  const plain = { ...chat };
  assert.equal(await B.withBackground(plain), plain, "no background asked: unchanged");
  ollamaHas([]);
  const r = await B.withBackground(task);
  assert.ok(r instanceof Response);
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /No local model/);
});

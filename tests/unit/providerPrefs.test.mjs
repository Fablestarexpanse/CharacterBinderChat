// The chat-model settings the server keeps: never the key, only sane values,
// and applying them keeps whatever the server does not hold.

import { test } from "node:test";
import assert from "node:assert/strict";

const P = await import("../../lib/settings/providerPrefs.ts");

const local = {
  ollama: { baseUrl: "http://127.0.0.1:11434", enabled: true, utilityModel: "qwen3:4b" },
  lmstudio: { baseUrl: "http://127.0.0.1:1234", enabled: false },
  openrouter: { apiKey: "sk-secret", enabled: true, defaultModel: "deepseek/deepseek-chat-v3.1" },
  comfyui: { baseUrl: "http://127.0.0.1:8188", enabled: true },
};

test("the kept part never carries the API key", () => {
  const kept = P.pickProviderPrefs(local);
  assert.equal(JSON.stringify(kept).includes("sk-secret"), false);
  assert.equal(kept.openrouter.defaultModel, "deepseek/deepseek-chat-v3.1");
});

test("untrusted input is cleaned: bad addresses refuse it, junk fields are dropped", () => {
  assert.equal(P.cleanProviderPrefs({ ...P.pickProviderPrefs(local), comfyui: { baseUrl: "file:///etc/passwd" } }), null);
  const c = P.cleanProviderPrefs({ ...P.pickProviderPrefs(local), openrouter: { enabled: true, defaultModel: 5, apiKey: "leak" }, vision: { provider: "nope", model: "x" } });
  assert.deepEqual(c.openrouter, { enabled: true });
  assert.equal("vision" in c, false);
});

test("the server's copy replaces the browser's, and the key the browser holds stays", () => {
  const server = P.cleanProviderPrefs({ ...P.pickProviderPrefs(local), openrouter: { enabled: true, defaultModel: "x/y" }, ollama: { baseUrl: "http://10.0.0.2:11434", enabled: true } });
  const out = P.applyProviderPrefs(local, server);
  assert.equal(out.openrouter.apiKey, "sk-secret");
  assert.equal(out.openrouter.defaultModel, "x/y");
  assert.equal(out.ollama.baseUrl, "http://10.0.0.2:11434");
  assert.equal(out.ollama.utilityModel, undefined, "the server had none, so none");
});

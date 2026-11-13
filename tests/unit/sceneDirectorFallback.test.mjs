// The image button without a local Ollama: the scene director runs on the
// chat's own model, and a missing or refused key says what to do.

import { test } from "node:test";
import assert from "node:assert/strict";
const { directorFallback } = await import("../../lib/server/scenePrompt.ts");
const { callLLM, callOpenAICompat } = await import("../../lib/llm/callers.ts");

test("the chat's model is a usable fallback; anything malformed is not", () => {
  assert.deepEqual(directorFallback({ providerType: "openrouter", providerBaseUrl: "https://evil.example", modelId: "x/y", apiKey: "k" }),
    { providerType: "openrouter", providerBaseUrl: "https://openrouter.ai/api", modelId: "x/y", apiKey: "k" }, "OpenRouter always goes to openrouter.ai");
  assert.deepEqual(directorFallback({ providerType: "lmstudio", providerBaseUrl: "http://127.0.0.1:1234/", modelId: "m" }),
    { providerType: "lmstudio", providerBaseUrl: "http://127.0.0.1:1234", modelId: "m", apiKey: undefined });
  for (const bad of [undefined, null, {}, { providerType: "nope", modelId: "m" }, { providerType: "lmstudio", modelId: "m", providerBaseUrl: "file:///etc" }, { providerType: "ollama", providerBaseUrl: "http://x", modelId: " " }])
    assert.equal(directorFallback(bad), null, JSON.stringify(bad));
});

test("OpenRouter without a key, or with a refused one, says to fix the key in Settings", async () => {
  await assert.rejects(callLLM({ providerType: "openrouter", providerBaseUrl: "", modelId: "x/y" }, "hi"), /no OpenRouter key: add it in Settings → Chat models/);
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 401 });
  try {
    await assert.rejects(callOpenAICompat("https://openrouter.ai/api", "x/y", "hi", "bad"), /refused the API key \(HTTP 401\): check it in Settings/);
  } finally { globalThis.fetch = real; }
});

test("a LoRA pipeline with no LoRA to apply is made with its plain workflow", async () => {
  const { plainWhenNoLora } = await import("../../lib/media/imageLook.ts");
  const s = { workflow: "krea2-lora-pipeline", loras: [], prompt: "p" };
  assert.equal(plainWhenNoLora(s).workflow, "krea2-photo");
  assert.equal(plainWhenNoLora({ ...s, loras: [{ name: "x.safetensors", weight: 1 }] }).workflow, "krea2-lora-pipeline", "with a LoRA: unchanged");
  assert.equal(plainWhenNoLora({ ...s, workflow: "moss-photo" }).workflow, "moss-photo", "other workflows: unchanged");
});

// Every backend spells the sampler knobs differently, so nothing is sent
// verbatim. These assert the translation, including the slot each field goes
// in — an option in the wrong slot is silently ignored by the provider.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./_load.mjs";

const { buildRequestParams, paramSupport, DEFAULT_GENERATION_PARAMS } =
  await load("lib/providers/params.ts");

test("ollama puts sampler fields under options with its own names", () => {
  const { root, options } = buildRequestParams("ollama", { temperature: 0.7, topP: 0.9, maxTokens: 512 });
  assert.deepEqual(root, {});
  assert.equal(options.temperature, 0.7);
  assert.equal(options.top_p, 0.9);
  assert.equal(options.num_predict, 512);   // not "maxTokens"
});

test("openrouter puts them at the root with OpenAI names", () => {
  const { root, options } = buildRequestParams("openrouter", { temperature: 0.7, repetitionPenalty: 1.1 });
  assert.deepEqual(options, {});
  assert.equal(root.temperature, 0.7);
  assert.equal(root.repetition_penalty, 1.1);
  assert.equal(root.max_tokens, DEFAULT_GENERATION_PARAMS.maxTokens); // always sent
});

test("non-finite values are dropped rather than sent", () => {
  const { options } = buildRequestParams("ollama", { temperature: Number.NaN, topK: 40 });
  assert.equal("temperature" in options, false);
  assert.equal(options.top_k, 40);
});

test("an unknown provider falls back to the ollama mapping", () => {
  const { options } = buildRequestParams("who-knows", { temperature: 0.5 });
  assert.equal(options.temperature, 0.5);
});

test("paramSupport reports what a provider accepts", () => {
  assert.equal(paramSupport("ollama", "repetitionPenalty"), "supported");
  assert.equal(paramSupport("nonexistent", "temperature"), "unsupported");
});

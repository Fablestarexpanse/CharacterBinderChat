// Two parsers that read input the app does not control: the base URL a request
// body supplies, and whatever a local model decided to emit. Both are the kind
// of code that is only exercised when something is already going wrong.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./_load.mjs";

const { parseProviderBase, isProviderType, parseLLMJson, PROVIDER_TYPES } =
  await load("lib/llm/callers.ts");

test("a provider base URL must be http(s), and loses its trailing slash", () => {
  assert.equal(parseProviderBase("http://localhost:11434/"), "http://localhost:11434");
  assert.equal(parseProviderBase("https://openrouter.ai/api"), "https://openrouter.ai/api");
});

test("anything that lets a body choose the scheme is rejected", () => {
  for (const bad of ["file:///etc/passwd", "ftp://host", "javascript:alert(1)", "data:text/plain,x", "", "not a url"]) {
    assert.equal(parseProviderBase(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test("provider names are checked against the list, not assumed", () => {
  for (const good of PROVIDER_TYPES) assert.equal(isProviderType(good), true, good);
  for (const bad of ["comfyui", "OLLAMA", "", null, undefined, 7]) {
    assert.equal(isProviderType(bad), false, String(bad));
  }
});

test("model output that is a JSON object is parsed", () => {
  assert.deepEqual(parseLLMJson('{"facts":[]}', null), { facts: [] });
});

test("markdown fences and surrounding chatter are stripped", () => {
  const fenced = '```json\n{"ok":true}\n```';
  assert.deepEqual(parseLLMJson(fenced, null), { ok: true });
  assert.deepEqual(parseLLMJson('Sure! Here you go: {"ok":true} — hope that helps', null), { ok: true });
});

test("valid JSON that is not an object falls back", () => {
  // A bare array or number used to sail through the `as T` cast and fail
  // later as a property access on the wrong type.
  for (const notAnObject of ["[1,2,3]", "42", '"a string"', "null", "true"]) {
    assert.equal(parseLLMJson(notAnObject, null), null, notAnObject);
  }
});

test("unparseable output falls back rather than throwing", () => {
  assert.equal(parseLLMJson("I'm sorry, I can't do that.", null), null);
  assert.equal(parseLLMJson("", null), null);
  assert.deepEqual(parseLLMJson("{oops", { fallback: true }), { fallback: true });
});

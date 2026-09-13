// The Drawer 1 rewrite, with the model stubbed. The rule worth protecting is
// mood homeostasis: the model's reading is blended 0.6/0.4 with the prior
// rather than replacing it. Wholesale replacement pinned valence at ±1.0 under
// sustained tone and produced 0.99 → 0.00 → 1.00 whiplash at scene changes in
// the 200-exchange soak, and a "simplification" back to assignment would look
// harmless in review.
//
// FABLE_DB_PATH is set before the first import because getStore() reads it
// once and caches the instance on globalThis.

process.env.FABLE_DB_PATH = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";

const { rewriteCoreMemory } = await import("../../lib/server/memoryRewriter.ts");
const { getStore }          = await import("../../lib/db/index.ts");

const CHAT = "c1";
const CHAR = "ash";

/** Answer the next chat completion with this JSON body, as the model would. */
function stubModel(reply) {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ response: JSON.stringify(reply) }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
}

/** Answer with something that is not JSON at all. */
function stubProse(text) {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ response: text }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
}

const backend = {
  chatId: CHAT, characterId: CHAR, characterName: "Ash",
  recentMessages: [{ role: "user", content: "hey" }],
  providerType: "ollama", providerBaseUrl: "http://127.0.0.1:11434", modelId: "m",
};

function seedMemory(mood) {
  const store = getStore();
  store.ensureCoreMemory(CHAT, CHAR, "Ash");
  const current = store.getCoreMemory(CHAT, CHAR);
  store.patchCoreMemory(CHAT, CHAR, { ...current.data, mood });
  return store;
}

test("a character with no core memory is reported, not invented", async () => {
  stubModel({ persona: "should never be read" });

  const result = await rewriteCoreMemory({ ...backend, chatId: "chat-with-nothing" });

  assert.equal(result.ok, false);
  assert.match(result.error, /No core memory/);
});

test("mood is blended with the prior, not replaced", async () => {
  const store = seedMemory({ valence: 0.0, arousal: 0.5, dominance: 0.5 });
  stubModel({ persona: "p", mood: { valence: 1.0, arousal: 1.0, dominance: 0.0 },
              internal_thoughts: [], narrative_summary: "s", persona_changed: false });

  const result = await rewriteCoreMemory(backend);

  assert.equal(result.ok, true);
  const mood = store.getCoreMemory(CHAT, CHAR).data.mood;
  // 0.6 * model + 0.4 * prior, per axis.
  assert.ok(Math.abs(mood.valence   - 0.6) < 1e-9, `valence blended, got ${mood.valence}`);
  assert.ok(Math.abs(mood.arousal   - 0.8) < 1e-9, `arousal blended, got ${mood.arousal}`);
  assert.ok(Math.abs(mood.dominance - 0.2) < 1e-9, `dominance blended, got ${mood.dominance}`);
});

test("a missing or non-finite mood axis keeps the prior instead of zeroing it", async () => {
  const store = seedMemory({ valence: 0.4, arousal: 0.6, dominance: 0.3 });
  stubModel({ persona: "p", mood: { arousal: "very high" },
              internal_thoughts: [], narrative_summary: "s" });

  await rewriteCoreMemory(backend);

  const mood = store.getCoreMemory(CHAT, CHAR).data.mood;
  assert.equal(mood.valence, 0.4, "an axis the model omitted must not move");
  assert.equal(mood.arousal, 0.6, "a non-numeric axis must not move either");
  assert.equal(mood.dominance, 0.3);
});

test("blended mood stays inside each axis's range", async () => {
  const store = seedMemory({ valence: -1, arousal: 0, dominance: 0 });
  stubModel({ persona: "p", mood: { valence: -5, arousal: -5, dominance: 5 },
              internal_thoughts: [], narrative_summary: "s" });

  await rewriteCoreMemory(backend);

  const mood = store.getCoreMemory(CHAT, CHAR).data.mood;
  assert.ok(mood.valence >= -1 && mood.valence <= 1);
  assert.ok(mood.arousal >= 0 && mood.arousal <= 1, "arousal is 0..1, not -1..1");
  assert.ok(mood.dominance >= 0 && mood.dominance <= 1);
});

test("fields the model omitted keep their current value", async () => {
  const store = seedMemory({ valence: 0, arousal: 0.5, dominance: 0.5 });
  const before = store.getCoreMemory(CHAT, CHAR).data;
  stubModel({ mood: { valence: 0, arousal: 0.5, dominance: 0.5 } });

  await rewriteCoreMemory(backend);

  const after = store.getCoreMemory(CHAT, CHAR).data;
  assert.equal(after.persona, before.persona);
  assert.equal(after.narrative_summary, before.narrative_summary);
  assert.deepEqual(after.internal_thoughts, before.internal_thoughts);
});

test("unparseable model output is reported rather than written", async () => {
  const store = seedMemory({ valence: 0.2, arousal: 0.5, dominance: 0.5 });
  const before = store.getCoreMemory(CHAT, CHAR).data.persona;
  stubProse("I'm sorry, I can't help with that.");

  const result = await rewriteCoreMemory(backend);

  assert.equal(result.ok, false);
  assert.match(result.error, /unparseable/i);
  assert.equal(store.getCoreMemory(CHAT, CHAR).data.persona, before,
    "a failed rewrite must leave the document alone");
});

test("an unreachable model is reported, not thrown", async () => {
  seedMemory({ valence: 0, arousal: 0.5, dominance: 0.5 });
  globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };

  const result = await rewriteCoreMemory(backend);

  assert.equal(result.ok, false);
  assert.ok(result.error.includes("ECONNREFUSED"));
});

test("persona_changed rides back out on the result", async () => {
  seedMemory({ valence: 0, arousal: 0.5, dominance: 0.5 });
  stubModel({ persona: "changed", mood: { valence: 0, arousal: 0.5, dominance: 0.5 },
              internal_thoughts: [], narrative_summary: "s", persona_changed: true });

  assert.equal((await rewriteCoreMemory(backend)).changed, true);
});

// The prompt is the product: what the model sees decides what the character
// knows. These assert the sections that carry memory, and the defaults that
// must NOT appear (a placeholder persona in the prompt reads as canon).

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./_load.mjs";

const { buildSystemPrompt, formatCoreMemoryBlock, estimateTokens } =
  await load("lib/chat/promptBuilder.ts");

const character = { id: "char-ash", name: "Ash", description: "A swimmer.", personality: "Wry.", tags: [] };
const persona   = { id: "p", name: "Kira", description: "A courier." };

test("no character means no character prompt", () => {
  assert.equal(buildSystemPrompt({}), "You are a helpful assistant.");
});

test("identity, description and persona all reach the prompt", () => {
  const out = buildSystemPrompt({ character, persona });
  assert.match(out, /You are Ash/);
  assert.match(out, /A swimmer\./);
  assert.match(out, /roleplaying as Kira/);
});

test("retrieved memory appears under its own headings", () => {
  const out = buildSystemPrompt({
    character,
    knownFacts:     ["Ash fears deep water"],
    episodes:       ["The crossing — she froze on the bank"],
    insights:       ["She avoids water routes"],
    lore:           ["Harbor District: the old docks"],
    sharedLanguage: ["Rookie"],
  });
  assert.match(out, /\[Known Facts\][\s\S]*Ash fears deep water/);
  assert.match(out, /\[Memorable Scenes\][\s\S]*froze on the bank/);
  assert.match(out, /\[What You Have Come To Understand\][\s\S]*avoids water routes/);
  assert.match(out, /\[World Lore\][\s\S]*old docks/);
  assert.match(out, /\[Shared Language\][\s\S]*Rookie/);
});

test("empty retrieval emits no empty headings", () => {
  const out = buildSystemPrompt({ character, knownFacts: [], episodes: [], sharedLanguage: [] });
  assert.equal(/\[Known Facts\]|\[Memorable Scenes\]|\[Shared Language\]/.test(out), false);
});

test("the default core-memory persona is not injected as if it were written", () => {
  const cm = {
    persona: "Ash is a character in this story. Their personality and backstory will emerge through conversation.",
    mood: { valence: 0, arousal: 0.3, dominance: 0.5 },
    relationship_with_user: { affection: 50, trust: 50, desire: 50, connection: 50 },
    active_commitments: [], recent_emotional_events: [], internal_thoughts: [],
    narrative_summary: "The story is just beginning.",
  };
  const block = formatCoreMemoryBlock(cm, "Ash");
  assert.equal(block.includes("emerge through conversation"), false);
  assert.equal(block.includes("The story is just beginning"), false);
});

test("a rewritten persona and a real summary DO reach the prompt", () => {
  const cm = {
    persona: "Ash has stopped pretending the record doesn't matter.",
    mood: { valence: 0.4, arousal: 0.6, dominance: 0.6 },
    relationship_with_user: { affection: 72, trust: 65, desire: 50, connection: 60 },
    active_commitments: ["Buy Kira breakfast"],
    recent_emotional_events: [], internal_thoughts: ["Don't let her see it"],
    narrative_summary: "They swam, she won, and he owes her a meal.",
  };
  // The rewritten persona reaches the prompt through buildSystemPrompt, which
  // is where the default-detection lives; the block carries the rest.
  assert.match(buildSystemPrompt({ character, coreMemory: cm }), /stopped pretending/);
  const block = formatCoreMemoryBlock(cm, "Ash");
  assert.match(block, /\[Active Commitments\][\s\S]*breakfast/);
  assert.match(block, /\[Internal Thoughts\][\s\S]*Don't let her see it/);
  assert.match(block, /\[Story So Far\][\s\S]*owes her a meal/);
});

test("estimateTokens grows with length and never returns zero for text", () => {
  assert.ok(estimateTokens("hello world") > 0);
  assert.ok(estimateTokens("a".repeat(400)) > estimateTokens("a".repeat(40)));
});

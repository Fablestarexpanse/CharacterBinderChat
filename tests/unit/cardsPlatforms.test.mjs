// How FableChat uses the ported platform layer: import of other sites' JSON, the
// "what will this platform drop" warning, and the macro spelling JanitorAI uses.

import { test } from "node:test";
import assert from "node:assert/strict";

const { lossyFields, convertCardTo } = await import("../../lib/cards/convert.ts");
const { characterToCard, expandMacros } = await import("../../lib/cards/tavern.ts");
const { convertPayload } = await import("../../lib/import/cardFile.ts");

const CHAR = {
  id: "c", name: "Ash", description: "A wary courier.", tags: ["noir"], createdAt: "", updatedAt: "",
  firstMessage: "Hi {{user}}.", systemPrompt: "Stay terse.", alternateGreetings: ["Late."], creator: "me",
};

test("JanitorAI JSON imports as a character, with {{bot}} turned back into {{char}}", () => {
  const janitor = { name: "Mira", persona: "{{bot}} is a smith.", world: "A forge.", greeting: "{{bot}} nods.", example_dialogs: "x", tags: ["fantasy"], visibility: "public", nsfw: false };
  const r = convertPayload(janitor, null);
  assert.equal(r.kind, "character");
  assert.equal(r.draft.name, "Mira");
  assert.match(r.draft.description, /\{\{char\}\} is a smith/);
  assert.equal(r.draft.firstMessage, "{{char}} nods.");
  assert.deepEqual(r.draft.tags, ["fantasy"]);
});

test("Agnai and Backyard JSON import too", () => {
  const agnai = convertPayload({ kind: "character", name: "A", description: "d", persona: { kind: "text", attributes: { personality: ["calm"] } }, sampleChat: "s", greeting: "g", systemPrompt: "sp" }, null);
  assert.equal(agnai.kind, "character");
  assert.equal(agnai.draft.personality, "calm");
  assert.equal(agnai.draft.systemPrompt, "sp");
  const backyard = convertPayload({ aiName: "B", basePrompt: "A baker.", initialMessage: "Hello", scenario: "A shop." }, null);
  assert.equal(backyard.kind, "character");
  assert.equal(backyard.draft.name, "B");
  assert.equal(backyard.draft.firstMessage, "Hello");
});

test("a normal V2 card and FableChat's own flat JSON still import as before", () => {
  const v2 = convertPayload(characterToCard(CHAR), "chara");
  assert.equal(v2.kind, "character");
  assert.equal(v2.draft.systemPrompt, "Stay terse.");
  const flat = convertPayload({ name: "Flat", description: "d", first_mes: "hi" }, null);
  assert.equal(flat.draft.firstMessage, "hi");
});

test("an exported JanitorAI card imports back to the same character where it can", () => {
  const out = convertCardTo(characterToCard(CHAR), "janitorai");
  const back = convertPayload(out, null);
  assert.equal(back.kind, "character");
  assert.equal(back.draft.name, "Ash");
  assert.match(back.draft.description, /A wary courier\./);
});

test("lossyFields lists only fields the card HAS that the platform drops", () => {
  const card = characterToCard(CHAR);
  const janitor = lossyFields(card, "janitorai");
  assert.ok(janitor.includes("System Prompt"));
  assert.ok(janitor.includes("Alternate Greetings"));
  assert.ok(janitor.includes("Creator"));
  assert.ok(!janitor.includes("Post-History"), "the card has no post-history, so it is not mentioned");
  assert.ok(!janitor.includes("Lorebook"), "nor a lorebook");
  assert.deepEqual(lossyFields(card, "sillytavern"), [], "the full V2 platform loses nothing");
});

test("a bare character reports no loss anywhere", () => {
  const bare = characterToCard({ id: "x", name: "B", description: "d", tags: [], createdAt: "", updatedAt: "" });
  for (const p of ["sillytavern", "janitorai", "chub", "agnai", "venus", "backyard", "risu", "generic"]) {
    const lost = lossyFields(bare, p);
    assert.ok(!lost.includes("System Prompt") && !lost.includes("Lorebook"), p);
  }
});

test("{{bot}} expands to the character's name", () => {
  assert.equal(expandMacros("{{bot}} meets {{user}}", { char: "Ash", user: "Kira" }), "Ash meets Kira");
});

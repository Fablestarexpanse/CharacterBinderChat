// The demo story a new install opens with: valid cards, a chat already under
// way, and never in the way of anything the user already has.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { buildDemo, addDemoStory, DEMO_IDS } = await import("../../lib/demo.ts");
const { characterToCard, loreToCharacterBook } = await import("../../lib/cards/tavern.ts");
const { validateTavernCardV2 } = await import("../../lib/cards/validate.ts");
const { useFableStore } = await import("../../lib/store/index.ts");

const empty = { characters: [], personas: [], lorebooks: [], scenarios: [], chats: [], activePersonaId: null, activeChatId: null };
beforeEach(() => useFableStore.setState(empty));

test("the demo character is a valid Tavern V2 card, lorebook included", () => {
  const d = buildDemo(new Date("2026-11-05T22:00:00Z"));
  const [c] = d.characters, [b] = d.lorebooks;
  const check = validateTavernCardV2(characterToCard(c, loreToCharacterBook(b.name, b.description, b.entries)));
  assert.ok(check.valid, check.errors.join("; "));
  assert.equal(c.lorebookId, b.id);
  assert.ok(b.entries.every((e) => e.key && e.value && e.enabled));
});

test("the demo chat opens in-fiction, addressed to the player, with no placeholders left", () => {
  const d = buildDemo(new Date("2026-11-05T22:00:00Z"), "Sam");
  const [chat] = d.chats;
  assert.equal(chat.characterId, DEMO_IDS.character);
  assert.equal(chat.messages[0].role, "assistant");
  assert.match(chat.messages[0].content, /You're late, Sam/);
  assert.ok(chat.messages.every((m) => !/\{\{(char|user)\}\}/.test(m.content)));
  assert.equal(chat.messages.at(-1).role, "assistant", "the next line is the user's");
  const times = chat.messages.map((m) => Date.parse(m.timestamp));
  assert.deepEqual(times, [...times].sort((a, b) => a - b), "messages are in order");
});

test("on an empty store it adds the whole story, makes the persona active and opens the chat", () => {
  assert.equal(addDemoStory(), true);
  const s = useFableStore.getState();
  assert.deepEqual([s.characters.length, s.personas.length, s.lorebooks.length, s.scenarios.length, s.chats.length], [1, 1, 1, 1, 1]);
  assert.equal(s.activePersonaId, DEMO_IDS.persona);
  assert.equal(s.activeChatId, DEMO_IDS.chat);
});

test("it never touches what is already there, keeps the user's persona, and adds itself only once", () => {
  const mine = { id: "p-me", name: "Ada", description: "Me.", createdAt: "x", updatedAt: "x" };
  const hero = { id: "c-hero", name: "Hero", description: "d", tags: [], createdAt: "x", updatedAt: "x" };
  useFableStore.setState({ ...empty, personas: [mine], activePersonaId: "p-me", characters: [hero] });
  addDemoStory();
  let s = useFableStore.getState();
  assert.deepEqual(s.personas.map((p) => p.id), ["p-me"], "no second persona when the user has one");
  assert.equal(s.activePersonaId, "p-me");
  assert.deepEqual(s.characters.map((c) => c.id), ["c-hero", DEMO_IDS.character]);
  assert.match(s.chats[0].messages[0].content, /You're late, Ada/);

  assert.equal(addDemoStory(), false, "already present: nothing added");
  s = useFableStore.getState();
  assert.equal(s.characters.length, 2);
  assert.equal(s.chats.length, 1);
});

// The Character <-> Tavern V2 mapping. The point of the whole card module is that
// a card survives a trip through FableChat, so these assert the round trip, plus
// the macro expansion that makes a downloaded card readable to a model at all.

import { test } from "node:test";
import assert from "node:assert/strict";

const { characterToCard, cardToCharacterDraft, loreToCharacterBook, expandMacros, formatExampleDialogue } =
  await import("../../lib/cards/tavern.ts");
const { encodeCardPng, BLANK_PNG } = await import("../../lib/cards/png.ts");
const { decodePngPayload, convertPayload } = await import("../../lib/import/cardFile.ts");
const { buildSystemPrompt } = await import("../../lib/chat/promptBuilder.ts");

const FULL = {
  id: "c1", name: "Ash", description: "A wary courier.", personality: "dry", scenario: "A harbor at dusk.",
  firstMessage: "*looks up* {{user}}.", tags: ["noir", "courier"],
  exampleDialogue: "<START>\n{{user}}: Hi\n{{char}}: Hm.",
  systemPrompt: "Stay terse.", postHistoryInstructions: "Never narrate {{user}}'s actions.",
  alternateGreetings: ["Late again.", "You're early."], creator: "me", creatorNotes: "v2 draft", characterVersion: "2.1",
  cardExtensions: { talkativeness: "0.4", world: "harbor" },
  image: { tags: "silver hair, scar on jaw, leather jacket", undressedTags: "silver hair, scar on jaw, athletic build", avoid: "glasses", lora: { name: "ash_v2", trigger: "a5h", weight: 0.8 }, seed: 1234 },
  createdAt: "", updatedAt: "",
};

test("a character survives export to a card and import back, every field intact", () => {
  const draft = cardToCharacterDraft(characterToCard(FULL));
  for (const k of ["name", "description", "personality", "scenario", "firstMessage", "tags", "exampleDialogue",
    "systemPrompt", "postHistoryInstructions", "alternateGreetings", "creator", "creatorNotes", "characterVersion", "cardExtensions", "image"]) {
    assert.deepEqual(draft[k], FULL[k], k);
  }
});

test("the same holds through a real PNG", () => {
  const png = encodeCardPng(BLANK_PNG, JSON.stringify(characterToCard(FULL)), "chara");
  const payload = decodePngPayload(png);
  assert.equal(payload.key, "chara");
  const card = convertPayload(payload.json, payload.key);
  assert.equal(card.kind, "character");
  assert.equal(card.draft.exampleDialogue, FULL.exampleDialogue);
  assert.deepEqual(card.draft.alternateGreetings, FULL.alternateGreetings);
  assert.deepEqual(card.draft.cardExtensions, FULL.cardExtensions);
});

test("the exported card is spec-shaped, with empty strings for absent fields", () => {
  const card = characterToCard({ id: "x", name: "Bare", description: "d", tags: [], createdAt: "", updatedAt: "" });
  assert.equal(card.spec, "chara_card_v2");
  assert.equal(card.spec_version, "2.0");
  assert.equal(card.data.mes_example, "");
  assert.deepEqual(card.data.alternate_greetings, []);
  assert.deepEqual(card.data.extensions, {});
  assert.equal(card.data.character_version, "1.0");
  assert.equal("character_book" in card.data, false);
});

test("a v1 flat card and a nameless card are handled", () => {
  assert.equal(cardToCharacterDraft({ name: "Flat", description: "d", first_mes: "hi" }).firstMessage, "hi");
  assert.equal(cardToCharacterDraft({ spec: "chara_card_v2", data: { name: "  " } }), null);
  assert.equal(cardToCharacterDraft(null), null);
  assert.equal(cardToCharacterDraft("string"), null);
});

test("empty optional fields import as absent, not as empty strings", () => {
  const d = cardToCharacterDraft({ spec: "chara_card_v2", data: { name: "A", description: "d", mes_example: "", system_prompt: "  ", alternate_greetings: ["", " "], extensions: {} } });
  assert.equal(d.exampleDialogue, undefined);
  assert.equal(d.systemPrompt, undefined);
  assert.equal(d.alternateGreetings, undefined);
  assert.equal(d.cardExtensions, undefined);
});

test("a lorebook embeds as a character_book with keys split and order kept", () => {
  const book = loreToCharacterBook("Harbor", "docs", [
    { id: "1", lorebookId: "b", key: "harbor, dock", value: "Gulls.", enabled: true, priority: 7, constant: false },
    { id: "2", lorebookId: "b", key: "always", value: "Fog.", enabled: false, constant: true },
  ]);
  assert.deepEqual(book.entries[0].keys, ["harbor", "dock"]);
  assert.equal(book.entries[0].insertion_order, 7);
  assert.equal(book.entries[1].enabled, false);
  assert.equal(book.entries[1].constant, true);
  assert.equal(characterToCard(FULL, book).data.character_book.name, "Harbor");
});

test("macros expand in every spelling, repeated, case-insensitively", () => {
  const out = expandMacros("{{char}} sees {{user}}. {{CHAR}} nods to {{ user }}. <BOT> <USER>", { char: "Ash", user: "Kira" });
  assert.equal(out, "Ash sees Kira. Ash nods to Kira. Ash Kira");
  assert.equal(expandMacros("no macros here", { char: "A", user: "B" }), "no macros here");
});

test("a name containing $ is inserted literally", () => {
  assert.equal(expandMacros("{{user}}", { char: "A", user: "$&Bob$1" }), "$&Bob$1");
});

test("example dialogue turns <START> into a separator", () => {
  assert.equal(formatExampleDialogue("<START>\na\n<start>\nb"), "---\na\n---\nb");
});

test("the prompt carries the card fields, expanded, in a sensible order", () => {
  const p = buildSystemPrompt({ character: FULL, persona: { id: "p", name: "Kira", description: "", createdAt: "", updatedAt: "" } });
  assert.ok(p.includes("[Character Instructions]\nStay terse."));
  assert.ok(p.includes("[Example Dialogue]"));
  assert.ok(p.includes("Kira: Hi\nAsh: Hm."), "placeholders filled in");
  assert.ok(p.includes("[Reminder]\nNever narrate Kira's actions."));
  assert.ok(!p.includes("{{"), "no placeholder reaches the model");
  assert.ok(p.indexOf("[Character Instructions]") < p.indexOf("A wary courier."), "instructions precede the sheet");
  assert.ok(p.indexOf("[Reminder]") > p.indexOf("[Example Dialogue]"));
  assert.ok(p.indexOf("[Reminder]") < p.indexOf("Speak as "), "reminder sits just before the standing rules");
});

test("a plain character's prompt is unchanged by the new fields", () => {
  const p = buildSystemPrompt({ character: { id: "x", name: "Plain", description: "d", tags: [], createdAt: "", updatedAt: "" } });
  for (const marker of ["[Character Instructions]", "[Example Dialogue]", "[Reminder]"]) assert.ok(!p.includes(marker), marker);
  assert.equal(p.includes("User"), false, "no stray persona text");
});

test("the image look travels under extensions.fablechat, beside other platforms' data, and is not stored twice", () => {
  const card = characterToCard({ ...FULL, cardExtensions: { ...FULL.cardExtensions, fablechat: { other: 1 } } });
  assert.deepEqual(card.data.extensions.fablechat, { other: 1, image: FULL.image });
  assert.equal(card.data.extensions.talkativeness, "0.4", "other platforms' extensions survive");
  const back = cardToCharacterDraft(card);
  assert.deepEqual(back.image, FULL.image);
  assert.deepEqual(back.cardExtensions, { talkativeness: "0.4", world: "harbor", fablechat: { other: 1 } }, "the look is lifted out, the rest kept");
  const none = characterToCard({ ...FULL, image: undefined });
  assert.equal(none.data.extensions.fablechat, undefined, "no look, no empty fablechat block");
  const hostile = cardToCharacterDraft({ spec: "chara_card_v2", data: { name: "X", description: "d", extensions: { fablechat: { image: { tags: 5, seed: -3, lora: { name: "" } } } } } });
  assert.equal(hostile.image, undefined, "a malformed look from a card is dropped, not stored");
});

test("a persona card carries its look and imports it back", async () => {
  const { personaToCard } = await import("../../lib/cards/tavern.ts");
  const look = { tags: "short dark hair, courier jacket" };
  const back = convertPayload(personaToCard({ name: "Kira", description: "A courier.", image: look }), "persona");
  assert.equal(back.kind, "persona");
  assert.deepEqual(back.image, look);
  assert.equal(convertPayload(personaToCard({ name: "Kira", description: "A courier." }), "persona").image, undefined);
});

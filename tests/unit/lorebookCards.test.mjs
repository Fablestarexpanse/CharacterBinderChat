// Lorebook parity: the fields the import used to drop (secondary keys, selective,
// case sensitivity, position) must now change matching, and must survive a round
// trip through export. Plus the persona and scenario cards, and the character's
// own lorebook riding inside their card.

import { test } from "node:test";
import assert from "node:assert/strict";

const { entryTriggered, matchLoreEntries } = await import("../../lib/chat/lorebook.ts");
const { convertPayload, parseLorebook } = await import("../../lib/import/cardFile.ts");
const { characterToCard, loreToCharacterBook, lorebookToCard, personaToCard, scenarioToCard } =
  await import("../../lib/cards/tavern.ts");

const entry = (o) => ({ id: "e", lorebookId: "b", key: "mira", value: "Mira is the smith.", enabled: true, ...o });

test("a plain entry fires on its keyword, case-insensitively, on whole words", () => {
  assert.equal(entryTriggered(entry({}), "I saw MIRA today"), true);
  assert.equal(entryTriggered(entry({ key: "art" }), "a particle"), false);
});

test("selective: needs a primary AND a secondary keyword", () => {
  const e = entry({ selective: true, secondaryKeys: ["sword", "forge"] });
  assert.equal(entryTriggered(e, "Mira waved"), false, "primary alone is not enough");
  assert.equal(entryTriggered(e, "the sword gleamed"), false, "secondary alone is not enough");
  assert.equal(entryTriggered(e, "Mira lifted the sword"), true);
  assert.equal(entryTriggered(e, "Mira stoked the FORGE"), true, "any one secondary will do");
});

test("selective with no secondary keys behaves as a plain entry rather than never firing", () => {
  assert.equal(entryTriggered(entry({ selective: true, secondaryKeys: [] }), "Mira"), true);
  assert.equal(entryTriggered(entry({ selective: true, secondaryKeys: ["  "] }), "Mira"), true);
});

test("secondary keys are ignored when selective is off", () => {
  assert.equal(entryTriggered(entry({ selective: false, secondaryKeys: ["sword"] }), "Mira"), true);
});

test("case sensitive: matches the exact case only", () => {
  const e = entry({ key: "Mira", caseSensitive: true });
  assert.equal(entryTriggered(e, "Mira"), true);
  assert.equal(entryTriggered(e, "mira"), false);
  assert.equal(entryTriggered(e, "MIRA"), false);
});

test("constant entries fire regardless, and disabled or empty ones never do", () => {
  assert.equal(entryTriggered(entry({ constant: true, key: "" }), ""), true);
  assert.equal(entryTriggered(entry({ enabled: false }), "mira"), false);
  assert.equal(entryTriggered(entry({ value: "  " }), "mira"), false);
});

test("matchLoreEntries applies the same rules and still orders by priority", () => {
  const books = [{ id: "b", name: "B", createdAt: "", entries: [
    entry({ id: "1", key: "mira", value: "low", priority: 1 }),
    entry({ id: "2", key: "mira", value: "high", priority: 9, selective: true, secondaryKeys: ["sword"] }),
  ] }];
  assert.deepEqual(matchLoreEntries(books, "Mira lifted the sword"), ["mira: high", "mira: low"]);
  assert.deepEqual(matchLoreEntries(books, "Mira waved"), ["mira: low"]);
});

test("a SillyTavern world-info entry imports with keysecondary, selective, and numeric position", () => {
  const book = parseLorebook({ entries: { 0: { key: ["mira"], keysecondary: ["sword"], content: "smith", selective: true, case_sensitive: true, position: 1, comment: "the smith" } } });
  const e = book.entries[0];
  assert.deepEqual(e.secondaryKeys, ["sword"]);
  assert.equal(e.selective, true);
  assert.equal(e.caseSensitive, true);
  assert.equal(e.position, "after_char");
  assert.equal(e.comment, "the smith");
});

test("a lorebook exports and re-imports with every field intact", () => {
  const original = [
    entry({ id: "1", key: "mira, the smith", value: "A smith.", priority: 7, selective: true, secondaryKeys: ["sword"], caseSensitive: true, position: "after_char", comment: "memo" }),
    entry({ id: "2", key: "fog", value: "It is foggy.", constant: true, enabled: false }),
  ];
  const card = lorebookToCard({ name: "Harbor", description: "docks", entries: original });
  const back = convertPayload(card, "lorebook");
  assert.equal(back.kind, "lorebook");
  assert.equal(back.book.name, "Harbor");
  const [a, b] = back.book.entries;
  assert.equal(a.key, "mira, the smith");
  assert.equal(a.priority, 7);
  assert.deepEqual(a.secondaryKeys, ["sword"]);
  assert.equal(a.selective, true);
  assert.equal(a.caseSensitive, true);
  assert.equal(a.position, "after_char");
  assert.equal(a.comment, "memo");
  assert.equal(b.constant, true);
  assert.equal(b.enabled, false);
});

test("a character's lorebook rides inside their card and comes back as an embedded book", () => {
  const book = loreToCharacterBook("Ash's world", "notes", [
    entry({ key: "harbor", value: "Gulls.", selective: true, secondaryKeys: ["night"], caseSensitive: true, comment: "m" }),
  ]);
  const char = { id: "c", name: "Ash", description: "d", tags: [], createdAt: "", updatedAt: "" };
  const result = convertPayload(characterToCard(char, book), "chara");
  assert.equal(result.kind, "character");
  assert.equal(result.embeddedBook.name, "Ash's world");
  const e = result.embeddedBook.entries[0];
  assert.deepEqual(e.secondaryKeys, ["night"]);
  assert.equal(e.selective, true);
  assert.equal(e.caseSensitive, true);
});

test("persona and scenario cards round trip", () => {
  const persona = convertPayload(personaToCard({ name: "Kira", description: "A courier." }), "persona");
  assert.equal(persona.kind, "persona");
  assert.equal(persona.name, "Kira");
  assert.match(persona.description, /A courier\./);

  const scenario = convertPayload(scenarioToCard({ name: "Storm", scenario: "A gale hits the harbor.", firstMessage: "The sky cracks." }), "scenario");
  assert.equal(scenario.kind, "scenario");
  assert.equal(scenario.name, "Storm");
  assert.equal(scenario.firstMessage, "The sky cracks.");
  assert.match(scenario.book.entries[0].value, /gale/);
});

test("a scenario with no opening message exports an empty first_mes, and a persona keeps its name", () => {
  assert.equal(scenarioToCard({ name: "S", scenario: "x" }).first_mes, "");
  assert.equal(personaToCard({ name: "P", description: "" }).spec, "persona_card_v1");
});

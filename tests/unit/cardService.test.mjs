// The server-side card service an agent writes through. What matters: input that
// looks fine but is not gets a useful refusal, every change is reversible, and an
// edit to one field does not disturb the rest of the card.

import { test } from "node:test";
import assert from "node:assert/strict";

const { FableStore } = await import("../../lib/db/store.ts");
const { createCard, updateCard, deleteCard, getCard, listCards, undo, CardError, cleanSource } = await import("../../lib/server/cards.ts");

const store = () => new FableStore(":memory:");
const ASH = { name: "Ash", description: "A wary courier.", personality: "dry", first_mes: "Hi {{user}}.", system_prompt: "Stay terse.", alternate_greetings: ["Late."], tags: ["noir"], creator: "me", extensions: { talkativeness: "0.4" } };

function throws(fn, re) {
  assert.throws(fn, (e) => { assert.ok(e instanceof CardError, `expected a CardError, got ${e}`); assert.match(e.message, re); return true; });
}

test("creating a character from bare fields stores every field, under the model's names", () => {
  const s = store();
  const r = createCard(s, "character", ASH, "agent");
  assert.equal(r.name, "Ash");
  const row = s.getRow("characters", r.id).data;
  assert.equal(row.firstMessage, "Hi {{user}}.");
  assert.equal(row.systemPrompt, "Stay terse.");
  assert.deepEqual(row.alternateGreetings, ["Late."]);
  assert.deepEqual(row.cardExtensions, { talkativeness: "0.4" });
  assert.ok(row.createdAt && row.updatedAt);
});

test("a whole V2 card is accepted too, including its embedded lorebook, which is created and linked", () => {
  const s = store();
  const card = { spec: "chara_card_v2", spec_version: "2.0", data: { ...ASH, character_book: { name: "Ash's world", entries: [{ keys: ["harbor"], content: "Gulls.", enabled: true, insertion_order: 1, extensions: {} }] } } };
  const r = createCard(s, "character", card, "agent");
  const row = s.getRow("characters", r.id).data;
  const book = s.getRow("lorebooks", row.lorebookId).data;
  assert.equal(book.name, "Ash's world");
  assert.equal(book.entries[0].lorebookId, book.id);
  assert.equal(book.entries[0].key, "harbor");
});

test("a character with no description is refused with the actual reason", () => {
  throws(() => createCard(store(), "character", { name: "Bare" }, "agent"), /Description is required/);
  throws(() => createCard(store(), "character", { description: "x" }, "agent"), /Name is required/);
});

test("the wrong kind of card for the type is refused, not stored as something else", () => {
  throws(() => createCard(store(), "persona", { spec: "chara_card_v2", spec_version: "2.0", data: { name: "A", description: "d" } }, "agent"), /not a persona/);
  throws(() => createCard(store(), "lorebook", "a string", "agent"), /must be a JSON object/);
  throws(() => createCard(store(), "lorebook", { name: "Junk", entries: [{ comment: "no keys, no content" }] }, "agent"), /no usable entries/);
});

test("an empty, named lorebook is a lorebook (the editor makes them; entries come later)", () => {
  const s = store();
  createCard(s, "lorebook", { name: "Empty", entries: [] }, "agent");
  assert.equal(listCards(s, "lorebook").length, 1);
});

test("every kind can be created and listed", () => {
  const s = store();
  createCard(s, "lorebook", { name: "Harbor", entries: [{ keys: ["dock"], content: "Gulls.", enabled: true }] }, "agent");
  createCard(s, "persona", { spec: "persona_card_v1", name: "Kira", description: "A courier." }, "agent");
  createCard(s, "scenario", { spec: "scenario_card_v1", name: "Storm", scenario: "A gale.", first_mes: "Thunder." }, "agent");
  assert.equal(listCards(s, "lorebook")[0].detail, "1 entries");
  assert.equal(listCards(s, "persona")[0].name, "Kira");
  assert.equal(s.getRow("scenarios", listCards(s, "scenario")[0].id).data.firstMessage, "Thunder.");
});

test("two characters with one name get different ids", () => {
  const s = store();
  const a = createCard(s, "character", ASH, "agent"), b = createCard(s, "character", ASH, "agent");
  assert.notEqual(a.id, b.id);
  assert.equal(listCards(s, "character").length, 2);
});

test("a created card reads back as the card that was sent", () => {
  const s = store();
  const { id } = createCard(s, "character", ASH, "agent");
  const card = getCard(s, "character", id);
  assert.equal(card.spec, "chara_card_v2");
  assert.equal(card.data.first_mes, "Hi {{user}}.");
  assert.deepEqual(card.data.extensions, { talkativeness: "0.4" });
});

test("updating one field leaves every other field, the id, art and creation time alone", () => {
  const s = store();
  const { id } = createCard(s, "character", ASH, "agent");
  s.patchAppState({ upserts: { characters: [{ ...s.getRow("characters", id).data, avatar: "data:image/png;base64,AAA" }] } });
  const before = s.getRow("characters", id).data;
  updateCard(s, "character", id, { personality: "warm" }, "agent");
  const after = s.getRow("characters", id).data;
  assert.equal(after.personality, "warm");
  for (const k of ["id", "name", "description", "firstMessage", "systemPrompt", "avatar", "createdAt", "cardExtensions"]) assert.deepEqual(after[k], before[k], k);
});

test("an empty string clears an optional field; name and description cannot be cleared", () => {
  const s = store();
  const { id } = createCard(s, "character", ASH, "agent");
  updateCard(s, "character", id, { system_prompt: "" }, "agent");
  assert.equal("systemPrompt" in s.getRow("characters", id).data, false);
  throws(() => updateCard(s, "character", id, { name: "  " }, "agent"), /name cannot be empty/);
  throws(() => updateCard(s, "character", id, { description: "" }, "agent"), /description cannot be empty/);
});

test("changes may arrive as a whole card; unknown fields and wrong types are refused with guidance", () => {
  const s = store();
  const { id } = createCard(s, "character", ASH, "agent");
  updateCard(s, "character", id, { data: { tags: ["a", "b"] } }, "agent");
  assert.deepEqual(s.getRow("characters", id).data.tags, ["a", "b"]);
  throws(() => updateCard(s, "character", id, { persnality: "x" }, "agent"), /unknown or unsupported field "persnality".*personality/);
  throws(() => updateCard(s, "character", id, { tags: "noir" }, "agent"), /array of strings/);
  throws(() => updateCard(s, "character", id, { character_book: {} }, "agent"), /type "lorebook"/);
  throws(() => updateCard(s, "character", id, {}, "agent"), /nothing to change/);
  throws(() => updateCard(s, "character", "nope", { name: "x" }, "agent"), /not found/);
});

test("lorebook entries are replaced wholesale and re-keyed", () => {
  const s = store();
  const { id } = createCard(s, "lorebook", { name: "H", entries: [{ keys: ["a"], content: "A." }] }, "agent");
  updateCard(s, "lorebook", id, { entries: [{ keys: ["b"], content: "B.", selective: true, secondary_keys: ["c"] }] }, "agent");
  const e = s.getRow("lorebooks", id).data.entries;
  assert.equal(e.length, 1);
  assert.equal(e[0].key, "b");
  assert.deepEqual(e[0].secondaryKeys, ["c"]);
  assert.equal(e[0].lorebookId, id);
});

test("every change is reversible: edit, delete and create each undo", () => {
  const s = store();
  const { id } = createCard(s, "character", ASH, "agent");
  const edited = updateCard(s, "character", id, { personality: "warm" }, "agent");
  undo(s, edited.historyId, "user");
  assert.equal(s.getRow("characters", id).data.personality, "dry", "edit undone");

  const del = deleteCard(s, "character", id, "agent");
  assert.equal(s.getRow("characters", id), null);
  undo(s, del.historyId, "user");
  assert.equal(s.getRow("characters", id).data.name, "Ash", "delete undone");

  const made = createCard(s, "persona", { spec: "persona_card_v1", name: "K", description: "d" }, "agent");
  const events = s.getChangesSince(0).events;
  const createEvent = events.find((e) => e.summary.includes("created persona"));
  undo(s, createEvent.historyId, "user");
  assert.equal(s.getRow("personas", made.id), null, "create undone");
});

test("undoing a created character also removes the lorebook that came with it", () => {
  const s = store();
  const card = { spec: "chara_card_v2", spec_version: "2.0", data: { ...ASH, character_book: { name: "W", entries: [{ keys: ["k"], content: "c", enabled: true, insertion_order: 1, extensions: {} }] } } };
  createCard(s, "character", card, "agent");
  const ev = s.getChangesSince(0).events[0];
  undo(s, ev.historyId, "user");
  assert.equal(listCards(s, "character").length, 0);
  assert.equal(listCards(s, "lorebook").length, 0);
});

test("an undo can be used once; a second attempt says so rather than doing something odd", () => {
  const s = store();
  const { id } = createCard(s, "character", ASH, "agent");
  const e = updateCard(s, "character", id, { personality: "warm" }, "agent");
  undo(s, e.historyId, "user");
  throws(() => undo(s, e.historyId, "user"), /can no longer be undone/);
});

test("each outside write bumps the revision and announces itself, with who did it", () => {
  const s = store();
  const before = s.rev();
  const { id } = createCard(s, "character", ASH, "Claude Code");
  deleteCard(s, "character", id, "Claude Code");
  const ch = s.getChangesSince(before);
  assert.equal(ch.rev, before + 2);
  assert.deepEqual(ch.events.map((e) => e.summary), ["Claude Code created character “Ash”", "Claude Code deleted character “Ash”"]);
  assert.deepEqual(ch.removals.characters, [id]);
});

test("a failed write leaves no history, no event and no revision behind", () => {
  const s = store();
  const { id } = createCard(s, "character", ASH, "agent");
  const rev = s.rev(), events = s.getChangesSince(0).events.length;
  assert.throws(() => updateCard(s, "character", id, { tags: 5 }, "agent"));
  assert.equal(s.rev(), rev);
  assert.equal(s.getChangesSince(0).events.length, events);
});

test("source labels are cleaned: printable, short, defaulting to agent", () => {
  assert.equal(cleanSource("Claude Code"), "Claude Code");
  assert.equal(cleanSource("<script>alert(1)</script>"), "scriptalert1/script");
  assert.equal(cleanSource(""), "agent");
  assert.equal(cleanSource(null), "agent");
  assert.equal(cleanSource("x".repeat(200)).length, 40);
});

test("an agent can set, clean and clear a character's image look, and a persona's", () => {
  const s = store();
  const { id } = createCard(s, "character", { ...ASH, image: { tags: "grey coat", seed: 7 } }, "agent");
  assert.deepEqual(getCard(s, "character", id).data.extensions.fablechat.image, { tags: "grey coat", seed: 7 }, "create takes a top-level image");
  updateCard(s, "character", id, { image: { tags: "red scarf", lora: { name: "" }, seed: -5 } }, "agent");
  assert.deepEqual(s.getRow("characters", id).data.image, { tags: "red scarf" }, "malformed parts are dropped");
  updateCard(s, "character", id, { image: null }, "agent");
  assert.equal(s.getRow("characters", id).data.image, undefined);
  const p = createCard(s, "persona", { spec: "persona_card_v1", name: "Kira", description: "A courier." }, "agent");
  updateCard(s, "persona", p.id, { image: { tags: "courier jacket" } }, "agent");
  assert.deepEqual(s.getRow("personas", p.id).data.image, { tags: "courier jacket" });
  assert.throws(() => updateCard(s, "persona", p.id, { image: "tags" }, "agent"), /must be an object/);
});

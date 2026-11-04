// Deleting a thing must not leave other things pointing at nothing, and must say what
// it affects. Before this, a chat whose character was deleted kept answering as a
// generic assistant with no memory, silently; a deleted lorebook stayed "linked".

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { useFableStore } = await import("../../lib/store/index.ts");
const { chatsUsingCharacter, charactersUsingLorebook, chatsListingLorebook, speakerIsMissing, plural } =
  await import("../../lib/chat/references.ts");
const { presentMemberIds } = await import("../../lib/chat/generation.ts");
const { FableStore } = await import("../../lib/db/store.ts");
const { createCard, deleteCard, undo, getCard, listCards } = await import("../../lib/server/cards.ts");

const reset = () => useFableStore.setState({ characters: [], chats: [], lorebooks: [], personas: [], scenarios: [], activeChatId: null });
beforeEach(reset);

// ─── Reference questions ────────────────────────────────────────────────────
test("chats using a character: 1:1 partners and group members both count, others do not", () => {
  const chats = [{ characterId: "a" }, { characterId: "b" }, { characterId: "b", memberIds: ["b", "a"] }, {}];
  assert.equal(chatsUsingCharacter(chats, "a"), 2);
  assert.equal(chatsUsingCharacter(chats, "b"), 2);
  assert.equal(chatsUsingCharacter(chats, "zzz"), 0);
});

test("a chat with no lorebook list uses every book, so it is not counted against any one", () => {
  assert.equal(chatsListingLorebook([{}, { lorebookIds: ["l1"] }, { lorebookIds: [] }, { lorebookIds: ["l2", "l1"] }], "l1"), 2);
});

test("an orphaned speaker is detected; a chat with no character at all is not orphaned", () => {
  assert.equal(speakerIsMissing("gone", [{ id: "a" }]), true);
  assert.equal(speakerIsMissing("a", [{ id: "a" }]), false);
  assert.equal(speakerIsMissing(undefined, [{ id: "a" }]), false, "a plain assistant chat is legitimate");
});

test("pluralising", () => { assert.equal(plural(1, "chat"), "1 chat"); assert.equal(plural(3, "chat"), "3 chats"); });

test("a deleted group member cannot be picked to speak", () => {
  const chat = { memberIds: ["a", "b", "c"], absentIds: ["c"] };
  assert.deepEqual(presentMemberIds(chat), ["a", "b"], "unchanged without a character list");
  assert.deepEqual(presentMemberIds(chat, [{ id: "a" }, { id: "c" }]), ["a"], "b was deleted, c is away");
});

// ─── The store ──────────────────────────────────────────────────────────────
test("deleting a lorebook clears the links to it on characters and chats, and touches nothing else", () => {
  const s = useFableStore.getState();
  const book = s.addLorebook("Harbor"), other = s.addLorebook("Other");
  const a = s.addCharacter({ name: "A", description: "d", tags: [], lorebookId: book });
  const b = s.addCharacter({ name: "B", description: "d", tags: [], lorebookId: other });
  useFableStore.setState({ chats: [
    { id: "c1", name: "x", messages: [], createdAt: "", updatedAt: "", lorebookIds: [book, other] },
    { id: "c2", name: "y", messages: [], createdAt: "", updatedAt: "" },                          // uses every book
  ] });

  s.deleteLorebook(book);

  const st = useFableStore.getState();
  assert.equal(st.lorebooks.length, 1);
  assert.equal("lorebookId" in st.characters.find((c) => c.id === a), false, "A no longer points at a deleted book");
  assert.equal(st.characters.find((c) => c.id === b).lorebookId, other, "B is untouched");
  assert.deepEqual(st.chats.find((c) => c.id === "c1").lorebookIds, [other]);
  assert.equal(st.chats.find((c) => c.id === "c2").lorebookIds, undefined, "a chat that uses all books stays that way");
});

// ─── The server / agent path ────────────────────────────────────────────────
const server = () => new FableStore(":memory:");
const ASH = { name: "Ash", description: "A courier." };
const WITH_BOOK = { spec: "chara_card_v2", spec_version: "2.0", data: { ...ASH, character_book: { name: "Ash's world", entries: [{ keys: ["k"], content: "c", enabled: true, insertion_order: 1, extensions: {} }] } } };

test("deleting a character reports how many chats depend on it, with a warning that names the undo", () => {
  const s = server();
  const { id } = createCard(s, "character", ASH, "agent");
  s.patchAppState({ upserts: { chats: [
    { id: "c1", characterId: id, messages: [] },
    { id: "c2", characterId: "someone-else", memberIds: ["someone-else", id], messages: [] },
    { id: "c3", characterId: "unrelated", messages: [] },
  ] } });
  const r = deleteCard(s, "character", id, "agent");
  assert.equal(r.usedBy.chats, 2);
  assert.match(r.warning, /2 chats use this character/);
  assert.match(r.warning, new RegExp(`historyId ${r.historyId}`));
});

test("deleting an unused character carries no warning", () => {
  const s = server();
  const { id } = createCard(s, "character", ASH, "agent");
  const r = deleteCard(s, "character", id, "agent");
  assert.equal(r.usedBy.chats, 0);
  assert.equal("warning" in r, false);
});

test("deleting a lorebook clears its owner's link in the same write, and one undo restores both", () => {
  const s = server();
  const made = createCard(s, "character", WITH_BOOK, "agent");
  const owner = s.getRow("characters", made.id).data;
  assert.ok(owner.lorebookId);
  const bookId = owner.lorebookId;

  const r = deleteCard(s, "lorebook", bookId, "agent");
  assert.deepEqual(r.usedBy.characters, ["Ash"]);
  assert.match(r.warning, /lorebook of Ash was deleted/);
  assert.equal("lorebookId" in s.getRow("characters", made.id).data, false, "no dangling link");
  assert.equal(s.getRow("lorebooks", bookId), null);

  undo(s, r.historyId, "user");
  assert.equal(s.getRow("characters", made.id).data.lorebookId, bookId, "the link is back");
  assert.equal(s.getRow("lorebooks", bookId).data.name, "Ash's world", "and so is the book");
  assert.equal(getCard(s, "character", made.id).data.character_book.name, "Ash's world", "the character exports with it again");
});

test("deleting a lorebook counts the chats that list it, and leaves the chat rows alone (the browser owns them)", () => {
  const s = server();
  const { id } = createCard(s, "lorebook", { name: "L", entries: [{ keys: ["k"], content: "c" }] }, "agent");
  s.patchAppState({ upserts: { chats: [{ id: "c1", characterId: "a", lorebookIds: [id], messages: [] }] } });
  const r = deleteCard(s, "lorebook", id, "agent");
  assert.equal(r.usedBy.chats, 1);
  assert.deepEqual(s.getRow("chats", "c1").data.lorebookIds, [id], "a chat is written only by the tab that owns it");
  assert.equal(listCards(s, "lorebook").length, 0);
});

test("the event the tab shows says what depended on the deleted card", () => {
  const s = server();
  const { id } = createCard(s, "character", ASH, "Claude Code");
  s.patchAppState({ upserts: { chats: [{ id: "c1", characterId: id, messages: [] }] } });
  deleteCard(s, "character", id, "Claude Code");
  const last = s.getChangesSince(0).events.at(-1);
  assert.match(last.summary, /Claude Code deleted character “Ash” \(1 chat uses it\)/);
});

test("characters whose own lorebook it is are found by id, not by name", () => {
  const chars = [{ id: "a", name: "A", lorebookId: "l1" }, { id: "b", name: "B", lorebookId: "l2" }, { id: "c", name: "l1" }];
  assert.deepEqual(charactersUsingLorebook(chars, "l1").map((c) => c.id), ["a"]);
  assert.deepEqual(charactersUsingLorebook(chars, "nope"), []);
});

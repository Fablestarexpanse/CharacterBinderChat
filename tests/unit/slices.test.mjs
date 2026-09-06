// Store slices, driven directly rather than through zustand: createXSlice is
// a plain function of (set, get), so a hand-rolled pair of those gives the
// actions a real state object with no persist middleware, no localStorage and
// no React. What is asserted here is the behaviour that is easy to break and
// invisible when it is broken — a deleted preset leaving chats pointing at it,
// a hydrate that keeps a stale active chat, a message inserted at the wrong
// index.

import { test } from "node:test";
import assert from "node:assert/strict";

const { createLibrarySlice } = await import("../../lib/store/slices/library.ts");
const { createChatsSlice }   = await import("../../lib/store/slices/chats.ts");

/** A minimal zustand stand-in: set(partial | fn) and get(). */
function harness(createSlice, initial = {}) {
  let state = {};
  const set = (update) => {
    const patch = typeof update === "function" ? update(state) : update;
    state = { ...state, ...patch };
  };
  const get = () => state;
  state = { ...createSlice(set, get, {}), ...initial };
  return { get: () => state, set };
}

// ─── Library slice ────────────────────────────────────────────────────────────

test("the first preset becomes the default, later ones do not", () => {
  const store = harness(createLibrarySlice);
  const first = store.get().addPreset("Warm");
  assert.equal(store.get().defaultPresetId, first,
    "a preset that applies to nothing is the bug this guards");

  store.get().addPreset("Cold");
  assert.equal(store.get().defaultPresetId, first, "the default must not move on its own");
  assert.equal(store.get().presets.length, 2);
});

test("deleting the default preset clears the default and unpoints its chats", () => {
  const store = harness(createLibrarySlice, { chats: [] });
  const id = store.get().addPreset("Warm");
  store.set({ chats: [{ id: "c1", presetId: id }, { id: "c2", presetId: "other" }] });

  store.get().deletePreset(id);

  assert.equal(store.get().defaultPresetId, null);
  assert.equal(store.get().presets.length, 0);
  assert.equal("presetId" in store.get().chats[0], false,
    "a chat must not keep a pointer to a preset that no longer exists");
  assert.equal(store.get().chats[1].presetId, "other", "other chats are untouched");
});

test("duplicating a preset copies its params under a new id", () => {
  const store = harness(createLibrarySlice);
  const id = store.get().addPreset("Warm");
  store.get().updatePreset(id, { params: { temperature: 1.2 } });

  const copyId = store.get().duplicatePreset(id);

  assert.notEqual(copyId, id);
  const copy = store.get().presets.find((p) => p.id === copyId);
  assert.equal(copy.name, "Warm copy");
  assert.deepEqual(copy.params, { temperature: 1.2 });
  assert.equal(store.get().duplicatePreset("no-such-preset"), null);
});

test("setChatPreset with undefined removes the key rather than storing undefined", () => {
  const store = harness(createLibrarySlice, { chats: [{ id: "c1", presetId: "p1" }] });

  store.get().setChatPreset("c1", undefined);

  // The chat is persisted as JSON, where an undefined value and an absent key
  // are the same thing on the way out but not on the way in.
  assert.equal("presetId" in store.get().chats[0], false);
});

test("resetChatOverrides drops the per-chat settings so the preset shows through", () => {
  const store = harness(createLibrarySlice, {
    chats: [{ id: "c1", settings: { temperature: 0.4 } }],
  });

  store.get().resetChatOverrides("c1");

  assert.equal("settings" in store.get().chats[0], false);
});

// ─── Chats slice ──────────────────────────────────────────────────────────────

const CHAT = { id: "c1", characterId: "ash", messages: [], updatedAt: "2020-01-01T00:00:00.000Z" };

function chatsHarness(initial = {}) {
  return harness(createChatsSlice, { chats: [structuredClone(CHAT)], ...initial });
}

test("addMessage appends and returns the new id", () => {
  const store = chatsHarness();

  const id = store.get().addMessage("c1", { role: "user", content: "hello" });

  const messages = store.get().chats[0].messages;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, id);
  assert.equal(messages[0].content, "hello");
  assert.notEqual(store.get().chats[0].updatedAt, CHAT.updatedAt, "the chat's timestamp moves");
});

test("insertMessageAfter puts the message directly after its anchor", () => {
  const store = chatsHarness();
  const first  = store.get().addMessage("c1", { role: "user", content: "one" });
  const third  = store.get().addMessage("c1", { role: "user", content: "three" });

  const second = store.get().insertMessageAfter("c1", first, { role: "assistant", content: "two" });

  assert.deepEqual(store.get().chats[0].messages.map((m) => m.id), [first, second, third]);
});

test("insertMessageAfter falls back to appending when the anchor is gone", () => {
  const store = chatsHarness();
  const only = store.get().addMessage("c1", { role: "user", content: "one" });

  const added = store.get().insertMessageAfter("c1", "no-such-message", { role: "assistant", content: "two" });

  assert.deepEqual(store.get().chats[0].messages.map((m) => m.id), [only, added]);
});

test("removeMessage takes one message and leaves the rest", () => {
  const store = chatsHarness();
  const a = store.get().addMessage("c1", { role: "user", content: "a" });
  const b = store.get().addMessage("c1", { role: "user", content: "b" });

  store.get().removeMessage("c1", a);

  assert.deepEqual(store.get().chats[0].messages.map((m) => m.id), [b]);
});

test("an action aimed at a missing chat changes nothing", () => {
  const store = chatsHarness();
  const before = store.get().chats;

  store.get().renameChat("no-such-chat", "New name");

  assert.deepEqual(store.get().chats, before);
});

test("renaming ignores whitespace-only names", () => {
  const store = chatsHarness();
  store.get().renameChat("c1", "   ");
  assert.equal(store.get().chats[0].name, undefined);

  store.get().renameChat("c1", "  Harbour night  ");
  assert.equal(store.get().chats[0].name, "Harbour night", "the stored name is trimmed");
});

test("hydrateFromServer takes the server's collections wholesale", () => {
  const store = chatsHarness({ activeChatId: "c1", activePersonaId: "p-old" });

  store.get().hydrateFromServer({
    characters: [], chats: [], personas: [], lorebooks: [], scenarios: [],
    presets: [], defaultPresetId: null, globalInstructions: {},
  });

  assert.deepEqual(store.get().lorebooks, [],
    "keeping a local copy over an empty server list resurrected deleted books once");
  assert.equal(store.get().activeChatId, null,
    "an active chat that no longer exists must not survive hydration");
  assert.equal(store.get().activePersonaId, null);
});

test("hydrateFromServer keeps an active chat the server still knows", () => {
  const store = chatsHarness({ activeChatId: "c1", activePersonaId: "p1" });

  store.get().hydrateFromServer({
    characters: [], chats: [structuredClone(CHAT)], personas: [{ id: "p1" }],
    lorebooks: [], scenarios: [], presets: [], defaultPresetId: null, globalInstructions: {},
  });

  assert.equal(store.get().activeChatId, "c1");
  assert.equal(store.get().activePersonaId, "p1");
});

test("hydrateFromServer falls back to the first persona when the active one is gone", () => {
  const store = chatsHarness({ activeChatId: null, activePersonaId: "p-old" });

  store.get().hydrateFromServer({
    characters: [], chats: [], personas: [{ id: "p1" }, { id: "p2" }],
    lorebooks: [], scenarios: [], presets: [], defaultPresetId: null, globalInstructions: {},
  });

  assert.equal(store.get().activePersonaId, "p1");
});

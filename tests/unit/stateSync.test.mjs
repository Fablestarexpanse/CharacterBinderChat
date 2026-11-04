// Incremental sync: the client diff and the server patch must agree, because a
// disagreement is silent data loss — a row never sent, a delete never applied,
// or a reorder that scrambles the sidebar after a reload.

import { test } from "node:test";
import assert from "node:assert/strict";

const { diffState, snapshot } = await import("../../lib/sync/stateDiff.ts");
const { FableStore } = await import("../../lib/db/store.ts");

const NAMES = ["characters", "chats", "personas", "lorebooks", "scenarios", "presets"];
const empty = () => Object.fromEntries(NAMES.map((n) => [n, []]));
const chat = (id, texts = []) => ({
  id, characterId: "ash",
  messages: texts.map((t, i) => ({ id: `${id}-m${i}`, chatId: id, role: "user", content: t })),
});

test("no change means no patch", () => {
  const state = { ...empty(), chats: [chat("c1", ["hi"])] };
  assert.equal(diffState(snapshot(state, NAMES), state, NAMES), null);
});

test("only the touched chat is sent; untouched ones are not", () => {
  const c1 = chat("c1", ["a"]), c2 = chat("c2", ["b"]);
  const before = { ...empty(), chats: [c1, c2] };
  const base = snapshot(before, NAMES);
  const c2b = { ...c2, messages: [...c2.messages, { id: "c2-m9", chatId: "c2", role: "user", content: "new" }] };
  const patch = diffState(base, { ...before, chats: [c1, c2b] }, NAMES);
  assert.deepEqual(patch.upserts.chats.map((c) => c.id), ["c2"]);
  assert.equal(patch.removals.chats, undefined);
  assert.equal(patch.order.chats, undefined, "order is unchanged so it is not resent");
});

test("a removal and a reorder are reported", () => {
  const [a, b, c] = [chat("a"), chat("b"), chat("c")];
  const base = snapshot({ ...empty(), chats: [a, b, c] }, NAMES);
  const patch = diffState(base, { ...empty(), chats: [c, a] }, NAMES);
  assert.deepEqual(patch.removals.chats, ["b"]);
  assert.deepEqual(patch.order.chats, ["c", "a"]);
});

test("applying the diff to the server reproduces the client state exactly", () => {
  const store = new FableStore(":memory:");
  const [a, b, c] = [chat("a", ["1", "2"]), chat("b", ["x"]), chat("c", ["y"])];
  const start = { ...empty(), characters: [{ id: "ash", name: "Ash" }], chats: [a, b, c] };
  store.replaceAppState({ ...start, defaultPresetId: null, globalInstructions: {} });

  // edit a (add a message), delete b, add d at the end, then move c first
  const a2 = { ...a, messages: [...a.messages, { id: "a-m9", chatId: "a", role: "assistant", content: "3" }] };
  const d = chat("d", ["new"]);
  const next = { ...start, chats: [c, a2, d] };
  const patch = diffState(snapshot(start, NAMES), next, NAMES);
  store.patchAppState(patch);

  const got = store.getAppState();
  assert.deepEqual(got.chats.map((x) => x.id), ["c", "a", "d"]);
  assert.deepEqual(got.chats.find((x) => x.id === "a").messages.map((m) => m.content), ["1", "2", "3"]);
  assert.equal(got.chats.find((x) => x.id === "d").messages[0].content, "new");
  assert.equal(got.chats.some((x) => x.id === "b"), false);
  // b's messages must not linger as orphans
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM app_messages WHERE chat_id='b'").get().n, 0);
  assert.equal(got.characters.length, 1, "collections absent from the patch are left alone");
});

test("a regenerated reply that drops a message removes it server-side", () => {
  const store = new FableStore(":memory:");
  const c1 = chat("c1", ["q", "old answer"]);
  store.replaceAppState({ ...empty(), chats: [c1], defaultPresetId: null, globalInstructions: {} });
  store.patchAppState({ upserts: { chats: [{ ...c1, messages: [c1.messages[0]] }] } });
  assert.equal(store.getAppState().chats[0].messages.length, 1);
});

test("countAfterPatch reports the result without writing", () => {
  const store = new FableStore(":memory:");
  store.replaceAppState({ ...empty(), chats: [chat("a"), chat("b"), chat("c")], defaultPresetId: null, globalInstructions: {} });
  const { before, after } = store.countAfterPatch({ removals: { chats: ["a", "b", "c"] } });
  assert.equal(before.chats, 3);
  assert.equal(after.chats, 0);
  assert.equal(store.getAppState().chats.length, 3);
});

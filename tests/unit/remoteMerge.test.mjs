// How an open tab takes in another writer's changes. The two rules that must not
// be confused: shared content takes the server's copy; a chat with unsaved local
// changes keeps the browser's (a reply being streamed must never be overwritten).

import { test } from "node:test";
import assert from "node:assert/strict";

const { mergeRemote } = await import("../../lib/sync/remote.ts");
const { snapshot } = await import("../../lib/sync/stateDiff.ts");

const NAMES = ["characters", "chats", "personas", "lorebooks", "scenarios", "presets"];
const c = (id, name = id) => ({ id, name });
const base = (local) => snapshot(local, NAMES);
const up = (...rows) => rows.map((data, i) => ({ seq: i, data }));

test("a new row from elsewhere is added; nothing else is touched", () => {
  const local = { characters: [c("a")] };
  const r = mergeRemote(local, base(local), { upserts: { characters: up(c("b")) }, removals: {} });
  assert.deepEqual(r.next.characters.map((x) => x.id), ["a", "b"]);
  assert.deepEqual(r.touched, [{ collection: "characters", id: "b" }]);
  assert.deepEqual(r.discarded, []);
  assert.equal(Object.keys(r.next).length, 1, "only the changed collection is returned");
});

test("a remote edit replaces a row the tab has not changed", () => {
  const local = { characters: [c("a", "old")] };
  const r = mergeRemote(local, base(local), { upserts: { characters: up(c("a", "agent")) }, removals: {} });
  assert.equal(r.next.characters[0].name, "agent");
  assert.deepEqual(r.discarded, []);
});

test("a remote edit beats an unsaved local edit of a shared row, and says so", () => {
  const saved = { characters: [c("a", "old")] };
  const baseline = base(saved);
  const local = { characters: [c("a", "my unsaved edit")] };            // a different object than the baseline's
  const r = mergeRemote(local, baseline, { upserts: { characters: up(c("a", "agent")) }, removals: {} });
  assert.equal(r.next.characters[0].name, "agent");
  assert.deepEqual(r.discarded, [{ collection: "characters", id: "a", what: "edit" }]);
});

test("a chat with unsaved local changes is NOT replaced", () => {
  const saved = { chats: [{ id: "c1", messages: [1] }] };
  const baseline = base(saved);
  const local = { chats: [{ id: "c1", messages: [1, 2, 3] }] };         // mid-stream
  const r = mergeRemote(local, baseline, { upserts: { chats: up({ id: "c1", messages: [1, 9] }) }, removals: {} });
  assert.equal(r.next.chats, undefined, "the collection is untouched");
  assert.deepEqual(r.touched, []);
  assert.deepEqual(r.discarded, []);
});

test("a chat with no unsaved changes does take the remote version", () => {
  const local = { chats: [{ id: "c1", messages: [1] }] };
  const r = mergeRemote(local, base(local), { upserts: { chats: up({ id: "c1", messages: [1, 2] }) }, removals: {} });
  assert.equal(r.next.chats[0].messages.length, 2);
});

test("our own write coming back is recognised and left alone, so it cannot echo into another save", () => {
  const row = { id: "a", name: "same", tags: ["x"] };
  const local = { characters: [row] };
  const r = mergeRemote(local, base(local), { upserts: { characters: up({ id: "a", name: "same", tags: ["x"] }) }, removals: {} });
  assert.deepEqual(r.next, {}, "nothing replaced");
  assert.deepEqual(r.touched, []);
});

test("a remote deletion removes an untouched row; an unsaved edit to it is reported as lost", () => {
  const local = { characters: [c("a"), c("b")] };
  const clean = mergeRemote(local, base(local), { upserts: {}, removals: { characters: ["a"] } });
  assert.deepEqual(clean.next.characters.map((x) => x.id), ["b"]);
  assert.deepEqual(clean.discarded, []);

  const baseline = base(local);
  const edited = { characters: [{ ...c("a"), name: "edited" }, c("b")] };
  const lost = mergeRemote(edited, baseline, { upserts: {}, removals: { characters: ["a"] } });
  assert.deepEqual(lost.discarded, [{ collection: "characters", id: "a", what: "edit" }]);
});

test("a chat the browser has unsaved changes to survives a remote deletion", () => {
  const saved = { chats: [{ id: "c", messages: [] }] };
  const baseline = base(saved);
  const local = { chats: [{ id: "c", messages: [1] }] };
  const r = mergeRemote(local, baseline, { upserts: {}, removals: { chats: ["c"] } });
  assert.equal(r.next.chats, undefined);
});

test("a remote edit to a row the tab deleted but has not saved wins (and is reported)", () => {
  const saved = { characters: [c("a")] };
  const baseline = base(saved);
  const r = mergeRemote({ characters: [] }, baseline, { upserts: { characters: up(c("a", "agent")) }, removals: {} });
  assert.deepEqual(r.next.characters, [c("a", "agent")]);
  assert.deepEqual(r.discarded, [{ collection: "characters", id: "a", what: "delete" }]);
});

test("a new remote chat is listed first (the tab lists chats newest first); cards append", () => {
  const local = { chats: [{ id: "old", messages: [] }], characters: [c("a")] };
  const r = mergeRemote(local, base(local), { upserts: { chats: up({ id: "new", messages: [] }), characters: up(c("b")) }, removals: {} });
  assert.deepEqual(r.next.chats.map((x) => x.id), ["new", "old"]);
  assert.deepEqual(r.next.characters.map((x) => x.id), ["a", "b"]);
});

test("malformed rows in a response are skipped rather than crashing the tab", () => {
  const local = { characters: [c("a")] };
  const r = mergeRemote(local, base(local), { upserts: { characters: [{ seq: 0, data: null }, { seq: 1, data: "x" }, { seq: 2, data: { name: "no id" } }] }, removals: {} });
  assert.deepEqual(r.next, {});
});

test("many collections at once are each handled independently", () => {
  const local = { characters: [c("a")], lorebooks: [c("l")] };
  const r = mergeRemote(local, base(local), { upserts: { lorebooks: up(c("l", "edited")) }, removals: { characters: ["a"] } });
  assert.deepEqual(r.next.characters, []);
  assert.equal(r.next.lorebooks[0].name, "edited");
});

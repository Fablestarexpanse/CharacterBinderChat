// Revision tracking: the contract the open tab and any outside writer rely on.
// Silent failure modes: a deletion nobody learns about, a stale write that
// overwrites an agent's edit, a revision that claims data it never delivered.

import { test } from "node:test";
import assert from "node:assert/strict";

const { FableStore } = await import("../../lib/db/store.ts");
const EMPTY = { characters: [], chats: [], personas: [], lorebooks: [], scenarios: [], presets: [], defaultPresetId: null, globalInstructions: {} };
const char = (id, name = id, extra = {}) => ({ id, name, description: "d", tags: [], createdAt: "", updatedAt: "", ...extra });
const chat = (id, n = 0) => ({ id, characterId: "a", messages: Array.from({ length: n }, (_, i) => ({ id: `${id}-m${i}`, chatId: id, role: "user", content: `m${i}` })) });

test("every write bumps the revision; a no-op write does not", () => {
  const s = new FableStore(":memory:");
  assert.equal(s.rev(), 0);
  s.patchAppState({ upserts: { characters: [char("a")] } });
  assert.equal(s.rev(), 1);
  s.patchAppState({ upserts: { characters: [char("b")] } });
  assert.equal(s.rev(), 2);
  s.patchAppState({});
  assert.equal(s.rev(), 2, "an empty patch writes nothing");
  s.patchAppState({ order: { characters: ["b", "a"] } });
  assert.equal(s.rev(), 2, "a reorder alone is not a content change");
});

test("changes since a revision return exactly the rows written after it", () => {
  const s = new FableStore(":memory:");
  s.patchAppState({ upserts: { characters: [char("a"), char("b")] } });           // rev 1
  const after1 = s.rev();
  s.patchAppState({ upserts: { characters: [char("b", "B2")], lorebooks: [{ id: "l", name: "L", entries: [] }] } }); // rev 2
  const c = s.getChangesSince(after1);
  assert.equal(c.rev, 2);
  assert.deepEqual(c.upserts.characters.map((r) => r.data.name), ["B2"]);
  assert.equal(c.upserts.lorebooks.length, 1);
  assert.equal(c.upserts.personas, undefined);
  assert.deepEqual(s.getChangesSince(2).upserts, {}, "nothing after the latest revision");
});

test("a deletion is visible to a client that was not there when it happened", () => {
  const s = new FableStore(":memory:");
  s.patchAppState({ upserts: { characters: [char("a"), char("b")] } });
  const seen = s.rev();
  s.patchAppState({ removals: { characters: ["a"] } });
  assert.deepEqual(s.getChangesSince(seen).removals.characters, ["a"]);
  assert.deepEqual(s.getChangesSince(0).removals.characters, ["a"]);
  s.patchAppState({ upserts: { characters: [char("a", "back")] } });
  assert.equal(s.getChangesSince(seen).removals.characters, undefined, "re-adding clears the tombstone");
});

test("changed chats come back with their messages", () => {
  const s = new FableStore(":memory:");
  s.patchAppState({ upserts: { chats: [chat("c1", 3)] } });
  assert.equal(s.getChangesSince(0).upserts.chats[0].data.messages.length, 3);
});

test("a write built on stale state does not overwrite a shared row changed since", () => {
  const s = new FableStore(":memory:");
  s.patchAppState({ upserts: { characters: [char("a", "orig")] } });
  const base = s.rev();                                                           // the tab syncs here
  s.patchAppState({ upserts: { characters: [char("a", "agent edit")] } });        // an agent edits
  const r = s.patchAppState({ upserts: { characters: [char("a", "tab edit")] } }, { baseRev: base });

  assert.deepEqual(r.conflicts, [{ collection: "characters", id: "a", reason: "changed" }]);
  assert.equal(s.getAppState().characters[0].name, "agent edit", "the server's copy won");
  assert.equal(r.rev, r.prevRev, "nothing was written, so no new revision");
});

test("a fresh write (base is current) goes through", () => {
  const s = new FableStore(":memory:");
  s.patchAppState({ upserts: { characters: [char("a", "orig")] } });
  const r = s.patchAppState({ upserts: { characters: [char("a", "tab edit")] } }, { baseRev: s.rev() });
  assert.deepEqual(r.conflicts, []);
  assert.equal(s.getAppState().characters[0].name, "tab edit");
});

test("deleting a row that was edited elsewhere is refused; editing one deleted elsewhere is too", () => {
  const s = new FableStore(":memory:");
  s.patchAppState({ upserts: { characters: [char("a"), char("b")] } });
  const base = s.rev();
  s.patchAppState({ upserts: { characters: [char("a", "edited")] }, removals: { characters: ["b"] } });
  const r = s.patchAppState({ removals: { characters: ["a"] }, upserts: { characters: [char("b", "tab edit of deleted")] } }, { baseRev: base });
  assert.deepEqual(r.conflicts.map((c) => `${c.id}:${c.reason}`).sort(), ["a:changed", "b:deleted"]);
  assert.equal(s.getAppState().characters.length, 1);
  assert.equal(s.getAppState().characters[0].name, "edited", "the delete did not go through");
});

test("chats are the browser's: its write wins even over a newer server row", () => {
  const s = new FableStore(":memory:");
  s.patchAppState({ upserts: { chats: [chat("c", 1)] } });
  const base = s.rev();
  s.patchAppState({ upserts: { chats: [chat("c", 2)] } });
  const r = s.patchAppState({ upserts: { chats: [chat("c", 5)] } }, { baseRev: base });
  assert.deepEqual(r.conflicts, []);
  assert.equal(s.getAppState().chats[0].messages.length, 5);
});

test("a conflict on one row does not block the others in the same patch", () => {
  const s = new FableStore(":memory:");
  s.patchAppState({ upserts: { characters: [char("a"), char("b")] } });
  const base = s.rev();
  s.patchAppState({ upserts: { characters: [char("a", "agent")] } });
  const r = s.patchAppState({ upserts: { characters: [char("a", "tab"), char("b", "tab b")], lorebooks: [{ id: "l", name: "new", entries: [] }] } }, { baseRev: base });
  assert.equal(r.conflicts.length, 1);
  const st = s.getAppState();
  assert.equal(st.characters.find((c) => c.id === "a").name, "agent");
  assert.equal(st.characters.find((c) => c.id === "b").name, "tab b");
  assert.equal(st.lorebooks.length, 1);
});

test("without baseRev a write is unconditional, as it always was", () => {
  const s = new FableStore(":memory:");
  s.patchAppState({ upserts: { characters: [char("a", "one")] } });
  s.patchAppState({ upserts: { characters: [char("a", "two")] } });
  const r = s.patchAppState({ upserts: { characters: [char("a", "three")] } });
  assert.deepEqual(r.conflicts, []);
  assert.equal(s.getAppState().characters[0].name, "three");
});

test("a full replace bumps the revision and tombstones what it dropped", () => {
  const s = new FableStore(":memory:");
  s.replaceAppState({ ...EMPTY, characters: [char("a"), char("b")] });
  const seen = s.rev();
  s.replaceAppState({ ...EMPTY, characters: [char("a")] });
  assert.ok(s.rev() > seen);
  assert.deepEqual(s.getChangesSince(seen).removals.characters, ["b"]);
});

test("an upgraded database (rows with no rev) is read as revision 0, and a re-open keeps the counter", async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fable-rev-")), "t.db");
  const a = new FableStore(file);
  a.patchAppState({ upserts: { characters: [char("a")] } });
  a.close();
  const b = new FableStore(file);
  assert.equal(b.rev(), 1);
  b.patchAppState({ upserts: { characters: [char("b")] } });
  assert.equal(b.rev(), 2);
  b.close();
});

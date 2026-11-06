// Image Studio's Delete and "Use for a character". Deleting a render must say what
// uses it, take its chat image cards with it (no dangling imageJobId), leave the
// portraits and references people kept, and be undoable back into place.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { renderUsage, renderIsUsed, removeRenders, restoreRenders, lookFromRenderPrompt } =
  await import("../../lib/media/renders.ts");
const { useFableStore } = await import("../../lib/store/index.ts");

const job = (id, extra = {}) => ({ id, prompt: `p ${id}`, status: "complete", settings: {}, outputUrls: [`/api/comfyui/view?f=${id}`], createdAt: "2026-01-01", ...extra });
const msg = (id, imageJobId) => ({ id, chatId: "c1", role: "assistant", content: "", createdAt: "2026-01-01", ...(imageJobId ? { imageJobId } : {}) });

test("usage: image cards per chat, and people holding a kept copy", () => {
  const chats = [
    { id: "c1", name: "Docks", messages: [msg("m1"), msg("m2", "j1"), msg("m3", "j1")] },
    { id: "c2", name: "Other", messages: [msg("m4", "j2")] },
  ];
  const people = [
    { id: "a", name: "Ronan", avatar: "/api/assets/aaa?w=96", referenceImages: [] },
    { id: "b", name: "Kira", avatar: "/api/assets/zzz", referenceImages: ["/api/assets/aaa"] },
    { id: "c", name: "Nobody" },
  ];
  const u = renderUsage(job("j1", { keptAs: { 0: "/api/assets/aaa" } }), chats, people);
  assert.deepEqual(u.cards, [{ chatId: "c1", chatName: "Docks", count: 2 }]);
  assert.deepEqual(u.portraitOf, ["Ronan"]);
  assert.deepEqual(u.referenceOf, ["Kira"]);
  assert.equal(renderIsUsed(u), true);

  const none = renderUsage(job("j9"), chats, people);
  assert.equal(renderIsUsed(none), false, "a render nobody kept and no chat shows is unused");
});

test("remove takes the render's image cards too; restore puts both back in place", () => {
  const jobs = [job("j0"), job("j1"), job("j2")];
  const chats = [{ id: "c1", messages: [msg("m1"), msg("m2", "j1"), msg("m3")] }, { id: "c2", messages: [msg("m4")] }];
  const out = removeRenders(jobs, chats, ["j1"]);
  assert.deepEqual(out.imageJobs.map((j) => j.id), ["j0", "j2"]);
  assert.deepEqual(out.chats[0].messages.map((m) => m.id), ["m1", "m3"]);
  assert.equal(out.chats[1], chats[1], "an untouched chat keeps its identity, so sync sends nothing for it");
  assert.ok(!out.chats.some((c) => c.messages.some((m) => m.imageJobId === "j1")), "no dangling card");

  const back = restoreRenders(out.imageJobs, out.chats, out.removed);
  assert.deepEqual(back.imageJobs.map((j) => j.id), ["j0", "j1", "j2"]);
  assert.deepEqual(back.chats[0].messages.map((m) => m.id), ["m1", "m2", "m3"]);

  const twice = restoreRenders(back.imageJobs, back.chats, out.removed);
  assert.equal(twice.imageJobs.length, 3, "restoring again does not duplicate");
  assert.equal(twice.chats[0].messages.length, 3);
});

test("restore skips a chat deleted since, and clamps positions to what is there", () => {
  const out = removeRenders([job("j1")], [{ id: "c1", messages: [msg("m1"), msg("m2"), msg("m3", "j1")] }], ["j1"]);
  const gone = restoreRenders([], [], out.removed);
  assert.deepEqual(gone.imageJobs.map((j) => j.id), ["j1"]);
  assert.deepEqual(gone.chats, []);
  const shorter = restoreRenders([], [{ id: "c1", messages: [msg("m1")] }], out.removed);
  assert.deepEqual(shorter.chats[0].messages.map((m) => m.id), ["m1", "m3"]);
});

test("unknown ids change nothing", () => {
  const jobs = [job("j0")], chats = [{ id: "c1", messages: [msg("m1")] }];
  const out = removeRenders(jobs, chats, ["nope"]);
  assert.equal(out.imageJobs, jobs);
  assert.equal(out.chats[0], chats[0]);
  assert.deepEqual(out.removed, { jobs: [], messages: [] });
});

test("the render's prompt becomes the new character's look tags, trimmed", () => {
  assert.deepEqual(lookFromRenderPrompt("  silver hair,\n  scar  "), { tags: "silver hair, scar" });
  assert.equal(lookFromRenderPrompt("   "), undefined);
  assert.equal(lookFromRenderPrompt(undefined), undefined);
  assert.equal(lookFromRenderPrompt("x".repeat(2000)).tags.length, 1000);
});

// ─── Through the store ──────────────────────────────────────────────────────
beforeEach(() => useFableStore.setState({ imageJobs: [], chats: [] }));

test("store: deleteRenders returns what it took and restoreRenders undoes it", () => {
  useFableStore.setState({
    imageJobs: [job("j1"), job("j2")],
    chats: [{ id: "c1", name: "Docks", characterId: "x", messages: [msg("m1"), msg("m2", "j1")], createdAt: "", updatedAt: "" }],
  });
  const removed = useFableStore.getState().deleteRenders(["j1"]);
  assert.deepEqual(useFableStore.getState().imageJobs.map((j) => j.id), ["j2"]);
  assert.deepEqual(useFableStore.getState().chats[0].messages.map((m) => m.id), ["m1"]);
  useFableStore.getState().restoreRenders(removed);
  assert.deepEqual(useFableStore.getState().imageJobs.map((j) => j.id), ["j1", "j2"]);
  assert.deepEqual(useFableStore.getState().chats[0].messages.map((m) => m.id), ["m1", "m2"]);
});

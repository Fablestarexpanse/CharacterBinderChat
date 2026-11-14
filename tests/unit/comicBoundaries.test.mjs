// Comic-it, second round: where a page starts survives deletes, re-rolls and
// branches; long stretches are split by size; LoRAs are chained into MOSS;
// recurring extras and comic LoRAs are kept clean.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { messagesSinceLastPage, nextPageStart } = await import("../../lib/chat/comic.ts");
const { chainLoras } = await import("../../lib/media/loraChain.ts");
const { cleanComicScript, layoutComicPage } = await import("../../lib/media/comicPage.ts");
const { cleanImageLook, withoutNames } = await import("../../lib/media/imageLook.ts");
const { useFableStore } = await import("../../lib/store/index.ts");
const { branchChat } = await import("../../lib/chat/branch.ts");

const m = (id, extra = {}) => ({ id, chatId: "c", role: "assistant", content: `line ${id}`, timestamp: "2026-11-13T10:00:00Z", ...extra });
const card = (id, fromId, upToId, recap = `recap ${id}`) => m(id, { imageJobId: `job-${id}`, content: "page", comic: { title: id, panels: 3, fromId, upToId, recapBefore: "", recap, script: { panels: [] } } });

test("the next page starts after the last page's boundary, or after the last page card when that message is gone", () => {
  const messages = [m("a"), m("b"), card("p1", "a", "b"), m("c"), m("d")];
  assert.equal(nextPageStart({ messages, comic: { upTo: "b", recap: "" } }), 2);
  assert.equal(nextPageStart({ messages, comic: { upTo: "deleted", recap: "" } }), 3, "the card's position stands in");
  assert.deepEqual(messagesSinceLastPage({ messages, comic: { upTo: "deleted", recap: "" } }).map((x) => x.id), ["c", "d"]);
  assert.equal(nextPageStart({ messages: [m("a")] }), 0);
});

test("a long stretch is cut by size, earliest first, never to nothing", () => {
  const long = Array.from({ length: 10 }, (_, i) => m(`L${i}`, { content: "x".repeat(4000) }));
  const got = messagesSinceLastPage({ messages: long });
  assert.equal(got.length, 3, "about 14,000 characters a page");
  assert.equal(got[0].id, "L0");
  assert.equal(messagesSinceLastPage({ messages: [m("huge", { content: "y".repeat(50_000) })] }).length, 1, "one huge message still makes a page");
});

beforeEach(() => useFableStore.setState({ chats: [], characters: [], personas: [], activePersonaId: null, isGenerating: false }));

test("deleting the latest page moves the boundary back to the page before; deleting the only page starts over", () => {
  const chat = { id: "c", name: "c", createdAt: "", updatedAt: "",
    messages: [m("a"), card("p1", "a", "a"), m("b"), card("p2", "b", "b", "recap p2")],
    comic: { upTo: "b", recap: "recap p2", personaId: "you", extras: [{ name: "Wraith", look: "pale ghost" }] } };
  useFableStore.setState({ chats: [chat] });
  useFableStore.getState().removeMessage("c", "p2");
  let c = useFableStore.getState().chats[0];
  assert.deepEqual([c.comic.upTo, c.comic.recap], ["a", "recap p1"]);
  assert.equal(c.comic.extras.length, 1, "recurring looks are kept");
  useFableStore.getState().removeMessage("c", "p1");
  c = useFableStore.getState().chats[0];
  assert.equal(nextPageStart(c), 0, "no pages left: the next one starts at the beginning");
  assert.equal(c.comic.extras[0].name, "Wraith");
});

test("a branch keeps the comic boundary, renamed to its own message ids", async () => {
  const chat = { id: "src", name: "src", createdAt: "", updatedAt: "",
    messages: [m("a", { chatId: "src" }), m("b", { chatId: "src" }), card("p1", "a", "b"), m("c", { chatId: "src" })],
    comic: { upTo: "b", recap: "r1" } };
  useFableStore.setState({ chats: [chat] });
  const out = await branchChat("src", "c");
  const branch = useFableStore.getState().chats.find((x) => x.id === out.chatId);
  const ids = branch.messages.map((x) => x.id);
  assert.equal(branch.comic.upTo, ids[1], "points at the branch's copy of b");
  assert.deepEqual([branch.messages[2].comic.fromId, branch.messages[2].comic.upToId], [ids[0], ids[1]]);
  assert.deepEqual(messagesSinceLastPage(branch).map((x) => x.content), ["line c"]);
});

test("LoRAs are chained in front of every sampler that reads the model, in order", () => {
  const wf = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: "moss.safetensors" } },
    "7": { class_type: "KSampler", inputs: { model: ["1", 0], seed: 1 } },
  };
  assert.equal(chainLoras(wf, [{ name: "MOSS\\style.safetensors", weight: 0.8 }, { name: "MOSS\\june.safetensors", weight: 1 }]), 2);
  assert.deepEqual(wf.fablechat_lora_1.inputs, { lora_name: "MOSS\\style.safetensors", strength_model: 0.8, model: ["1", 0] });
  assert.deepEqual(wf.fablechat_lora_2.inputs.model, ["fablechat_lora_1", 0]);
  assert.deepEqual(wf["7"].inputs.model, ["fablechat_lora_2", 0]);
  assert.equal(chainLoras({ "1": { class_type: "UNETLoader", inputs: {} } }, [{ name: "x", weight: 1 }]), 0, "no sampler: nothing added");
  const untouched = { "7": { class_type: "KSampler", inputs: { model: ["1", 0] } } };
  assert.equal(chainLoras(untouched, []), 0);
});

test("the script can bring in recurring people with a look; they appear on the page by their look", () => {
  const people = [{ name: "Tam Ashby", look: "red-haired courier" }];
  const s = cleanComicScript({ extras: [{ name: "The Wraith", look: "pale hooded ghost" }, { name: "Tam", look: "dupe" }, { name: "Nobody", look: "" }],
    panels: [{ shot: "The Wraith rises", characters: ["The Wraith", "Tam"], balloons: [{ speaker: "The Wraith", text: "Remember me." }] }] }, people);
  assert.deepEqual(s.extras, [{ name: "The Wraith", look: "pale hooded ghost" }], "only new people with a look; the cast is never duplicated");
  assert.deepEqual(s.panels[0].characters, ["The Wraith", "Tam Ashby"]);
  const page = layoutComicPage(s, [...people, ...s.extras], "");
  assert.match(page.summary.caption, /pale hooded ghost/);
  assert.equal(/Wraith|Tam/.test(page.items.filter((i) => i.label !== "text").map((i) => i.caption).join(" ")), false);
});

test("a character's comic LoRA is kept apart from their usual LoRA, and names with accents leave the picture", () => {
  const look = cleanImageLook({ lora: { name: "krea\\june" }, comicLora: { name: "MOSS\\june", weight: "0.7", trigger: "j0ne" } });
  assert.deepEqual(look.lora, { name: "krea\\june" });
  assert.deepEqual(look.comicLora, { name: "MOSS\\june", trigger: "j0ne", weight: 0.7 });
  assert.equal(withoutNames("Zoë Faure at the window, Zoë's coat", ["Zoë Faure"]), "at the window, their coat");
});

// CharacterBinder archive import. The ZIPs are built here with Node's zlib, an
// independent writer, so the reader is checked against real deflate output and not
// against its own idea of the format. Hostile archives matter: this reads files
// from the internet.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

const { readZip, isZip, MAX_ENTRIES } = await import("../../lib/cards/zip.ts");
const { planArchive, applyArchive, describeTally } = await import("../../lib/import/archive.ts");
const { useFableStore } = await import("../../lib/store/index.ts");
const { characterToCard, lorebookToCard, personaToCard, scenarioToCard } = await import("../../lib/cards/tavern.ts");
const { encodeCardPng, BLANK_PNG } = await import("../../lib/cards/png.ts");

// ─── A small ZIP writer ─────────────────────────────────────────────────────
function crc32(buf) {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; }
  return ~c >>> 0;
}
function makeZip(files, { method = 8 } = {}) {
  const enc = new TextEncoder();
  const locals = [], central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === "string" ? enc.encode(content) : content;
    const stored = method === 0 ? data : zlib.deflateRawSync(data);
    const nameBytes = enc.encode(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc32(data), 14); lh.writeUInt32LE(stored.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBytes.length, 26);
    const local = Buffer.concat([lh, nameBytes, stored]);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc32(data), 16); ch.writeUInt32LE(stored.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBytes.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([ch, nameBytes]));
    locals.push(local); offset += local.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

// ─── Fixtures ───────────────────────────────────────────────────────────────
const char = (name, extra = {}) => ({ id: name, name, description: `${name} desc`, tags: ["t"], createdAt: "", updatedAt: "", ...extra });
const charJson = (c, book) => JSON.stringify(characterToCard(c, book));
const noAvatar = async () => null;

function reset() {
  useFableStore.setState({ characters: [], lorebooks: [], personas: [], scenarios: [], activePersonaId: null });
}
beforeEach(reset);

// ─── Reader ─────────────────────────────────────────────────────────────────
test("reads deflated and stored entries, skipping directories", async () => {
  for (const method of [8, 0]) {
    const zip = makeZip({ "cards/a.json": '{"x":1}', "manifest.json": "[]" }, { method });
    assert.ok(isZip(zip));
    const entries = await readZip(zip);
    assert.deepEqual(entries.map((e) => e.name).sort(), ["cards/a.json", "manifest.json"]);
    assert.equal(new TextDecoder().decode(entries.find((e) => e.name === "cards/a.json").data), '{"x":1}');
  }
});

test("binary entries (a PNG) come back byte-for-byte", async () => {
  const png = encodeCardPng(BLANK_PNG, charJson(char("Ash")), "chara");
  const [entry] = await readZip(makeZip({ "cards/Ash.png": png }));
  assert.deepEqual([...entry.data], [...png]);
});

test("a file that is not a ZIP, or a truncated one, is refused clearly", async () => {
  await assert.rejects(() => readZip(new Uint8Array([1, 2, 3, 4, 5])), /not a ZIP/);
  const zip = makeZip({ "a.json": "{}" });
  await assert.rejects(() => readZip(zip.slice(0, zip.length - 30)), /no end record|damaged|past the end/);
});

test("an entry that inflates past the limit is refused rather than allocated", async () => {
  const bomb = makeZip({ "bomb.json": Buffer.alloc(80 * 1024 * 1024, 0x20) });   // 80 MB of spaces, a few KB compressed
  assert.ok(bomb.length < 200_000, "the archive itself is small");
  await assert.rejects(() => readZip(bomb), /larger than the allowed size/);
});

test("a header that lies about its size does not get around the limit", async () => {
  const zip = makeZip({ "a.json": Buffer.alloc(80 * 1024 * 1024, 0x20) });
  const view = new DataView(zip.buffer);
  // rewrite the declared uncompressed size (central directory) to something tiny
  const cd = zip.length - 22 - (46 + 6);
  view.setUint32(cd + 24, 10, true);
  await assert.rejects(() => readZip(zip), /larger than the allowed size/);
});

test("too many entries is refused up front", async () => {
  const files = Object.fromEntries(Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => [`f${i}.json`, "{}"]));
  await assert.rejects(() => readZip(makeZip(files, { method: 0 })), /entries; the limit/);
});

test("unsupported compression is named, not silently mangled", async () => {
  const zip = makeZip({ "a.json": "{}" }, { method: 0 });
  const view = new DataView(zip.buffer);
  view.setUint16(zip.length - 22 - (46 + 6) + 10, 12, true);   // bzip2
  await assert.rejects(() => readZip(zip), /unsupported compression method 12/);
});

// ─── Planning ───────────────────────────────────────────────────────────────
test("planning sorts every kind of card, ignores the manifest, and reports what it cannot read", async () => {
  const entries = await readZip(makeZip({
    "manifest.json": "[]",
    "cards/Ash.png": encodeCardPng(BLANK_PNG, charJson(char("Ash")), "chara"),
    "cards/Harbor.json": JSON.stringify(lorebookToCard({ name: "Harbor", entries: [{ id: "1", lorebookId: "b", key: "dock", value: "Gulls.", enabled: true }] })),
    "cards/Kira.json": JSON.stringify(personaToCard({ name: "Kira", description: "A courier." })),
    "cards/Storm.json": JSON.stringify(scenarioToCard({ name: "Storm", scenario: "A gale." })),
    "cards/broken.json": "{not json",
    "cards/notes.txt": "hi",
    "cards/blank.png": BLANK_PNG,
    "cards/Script.json": JSON.stringify({ spec: "script_card_v1", name: "S", content: "x" }),
  }));
  const plan = planArchive(entries);
  assert.deepEqual(plan.cards.map((c) => c.card.kind).sort(), ["character", "lorebook", "persona", "scenario", "unsupported"]);
  const reasons = Object.fromEntries(plan.skipped.map((s) => [s.name, s.reason]));
  assert.ok("broken.json" in reasons);
  assert.equal(reasons["notes.txt"], "not a card file");
  assert.match(reasons["blank.png"], /no embedded card/);
  assert.ok(plan.cards.find((c) => c.name === "Ash.png").png, "a PNG card keeps its bytes for the avatar");
});

// ─── Applying ───────────────────────────────────────────────────────────────
async function planOf(files) { return planArchive(await readZip(makeZip(files))); }

test("importing adds every kind straight to the library, characters without opening a review", async () => {
  const plan = await planOf({
    "a.json": charJson(char("Ash", { systemPrompt: "Stay terse." })),
    "b.json": charJson(char("Bo")),
    "l.json": JSON.stringify(lorebookToCard({ name: "Harbor", entries: [{ id: "1", lorebookId: "b", key: "dock", value: "Gulls.", enabled: true }] })),
    "p.json": JSON.stringify(personaToCard({ name: "Kira", description: "A courier." })),
    "s.json": JSON.stringify(scenarioToCard({ name: "Storm", scenario: "A gale.", firstMessage: "Thunder." })),
  });
  const t = await applyArchive(plan, noAvatar);
  assert.deepEqual([t.characters, t.lorebooks, t.personas, t.scenarios, t.duplicates], [2, 1, 1, 1, 0]);
  const s = useFableStore.getState();
  assert.equal(s.characters.find((c) => c.name === "Ash").systemPrompt, "Stay terse.", "card fields survive the migration");
  assert.equal(s.scenarios[0].firstMessage, "Thunder.");
  assert.equal(s.activePersonaId, s.personas[0].id, "with no persona yet, the store makes the first one active (its own rule)");
});

test("a migration never changes a persona the user already chose", async () => {
  const mine = useFableStore.getState().addPersona({ name: "Me", description: "mine" });
  await applyArchive(await planOf({ "p.json": JSON.stringify(personaToCard({ name: "Kira", description: "x" })) }), noAvatar);
  assert.equal(useFableStore.getState().activePersonaId, mine);
  assert.equal(useFableStore.getState().personas.length, 2);
});

test("importing the same archive twice adds nothing the second time", async () => {
  const files = { "a.json": charJson(char("Ash")), "p.json": JSON.stringify(personaToCard({ name: "Kira", description: "x" })) };
  await applyArchive(await planOf(files), noAvatar);
  const again = await applyArchive(await planOf(files), noAvatar);
  assert.equal(again.characters + again.personas, 0);
  assert.equal(again.duplicates, 2);
  assert.equal(useFableStore.getState().characters.length, 1);
});

test("a same-named but different character is NOT treated as a duplicate", async () => {
  await applyArchive(await planOf({ "a.json": charJson(char("Ash")) }), noAvatar);
  const t = await applyArchive(await planOf({ "b.json": charJson(char("Ash", { description: "a different Ash" })) }), noAvatar);
  assert.equal(t.characters, 1);
  assert.equal(useFableStore.getState().characters.length, 2);
});

test("a character's embedded lorebook is created and linked", async () => {
  const book = { name: "Ash's world", extensions: {}, entries: [{ keys: ["harbor"], content: "Gulls.", extensions: {}, enabled: true, insertion_order: 1 }] };
  await applyArchive(await planOf({ "a.json": charJson(char("Ash"), book) }), noAvatar);
  const s = useFableStore.getState();
  assert.equal(s.lorebooks.length, 1);
  assert.equal(s.characters[0].lorebookId, s.lorebooks[0].id);
});

test("a PNG card's art becomes the avatar", async () => {
  const png = encodeCardPng(BLANK_PNG, charJson(char("Ash")), "chara");
  await applyArchive(await planOf({ "Ash.png": png }), async () => "data:image/jpeg;base64,AVATAR");
  assert.equal(useFableStore.getState().characters[0].avatar, "data:image/jpeg;base64,AVATAR");
});

test("the summary names what happened, including skips", async () => {
  const plan = await planOf({ "a.json": charJson(char("Ash")), "x.json": "{bad", "script.json": JSON.stringify({ spec: "script_card_v1", name: "S", content: "x" }) });
  const msg = describeTally(await applyArchive(plan, noAvatar));
  assert.match(msg, /Imported 1 character\./);
  assert.match(msg, /Skipped 2/);
  assert.equal(describeTally({ characters: 0, lorebooks: 0, personas: 0, scenarios: 0, duplicates: 3, skipped: [] }),
    "Nothing new to import. 3 already in your library, left alone.");
});

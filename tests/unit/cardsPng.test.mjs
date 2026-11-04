// The PNG card codec: what it writes must be a structurally valid PNG that
// other tools (and this app) read back, and what it reads must survive hostile
// input. Ported from CharacterBinder, where each of these guards a bug that shipped.

import { test } from "node:test";
import assert from "node:assert/strict";

const png = await import("../../lib/cards/png.ts");
const { BLANK_PNG, encodeCardPng, decodeCardPng, isPng, pngDimensions } = png;

// An independent chunk walker, so BLANK_PNG is checked by code that is not the code under test
function walk(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  let off = 8;
  while (off < bytes.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(...bytes.slice(off + 4, off + 8));
    assert.ok(off + 12 + len <= bytes.length, `${type} runs past the end`);
    out.push({ type, len });
    off += 12 + len;
    if (type === "IEND") break;
  }
  assert.equal(off, bytes.length, "ends exactly on IEND");
  return out;
}

function crcOk(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tbl = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let off = 8;
  while (off < bytes.length) {
    const len = view.getUint32(off);
    let crc = 0xffffffff;
    for (const b of bytes.slice(off + 4, off + 8 + len)) crc = (crc >>> 8) ^ tbl[(crc ^ b) & 0xff];
    assert.equal(((crc ^ 0xffffffff) >>> 0), view.getUint32(off + 8 + len), "bad CRC");
    off += 12 + len;
  }
}


// Splice a tEXt chunk in after IHDR, built independently of the module under test
function insertText(bytes, keyword, text) {
  const enc = new TextEncoder();
  const body = enc.encode(`${keyword}\0${text}`);
  const tbl = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crcIn = new Uint8Array(4 + body.length); crcIn.set(enc.encode("tEXt")); crcIn.set(body, 4);
  let c = 0xffffffff; for (const b of crcIn) c = (c >>> 8) ^ tbl[(c ^ b) & 0xff];
  const chunk = new Uint8Array(12 + body.length);
  const v = new DataView(chunk.buffer);
  v.setUint32(0, body.length); chunk.set(enc.encode("tEXt"), 4); chunk.set(body, 8); v.setUint32(8 + body.length, (c ^ 0xffffffff) >>> 0);
  return new Uint8Array([...bytes.slice(0, 33), ...chunk, ...bytes.slice(33)]);
}

test("the blank carrier PNG is structurally valid", () => {
  assert.ok(isPng(BLANK_PNG));
  assert.deepEqual(walk(BLANK_PNG).map((c) => c.type), ["IHDR", "IDAT", "IEND"]);
  crcOk(BLANK_PNG);
  assert.deepEqual(pngDimensions(BLANK_PNG), { width: 1, height: 1 });
});

test("encode then decode returns the same JSON, and the output is still a valid PNG", () => {
  const json = JSON.stringify({ spec: "chara_card_v2", data: { name: "Ash", description: "wary" } });
  const out = encodeCardPng(BLANK_PNG, json, "chara");
  walk(out); crcOk(out);
  const d = decodeCardPng(out);
  assert.equal(d.json, json);
  assert.equal(d.key, "chara");
  assert.ok(d.chunks.some((c) => c.keyword === "name"), "SillyTavern's name chunk is written");
});

test("non-ASCII and large cards survive", () => {
  const json = JSON.stringify({ data: { name: "Léa 🌙", description: "é".repeat(200_000) } });
  assert.equal(decodeCardPng(encodeCardPng(BLANK_PNG, json, "chara")).json, json);
});

test("re-encoding replaces the old card and name chunks rather than adding to them", () => {
  const once = encodeCardPng(BLANK_PNG, JSON.stringify({ name: "Old" }), "chara");
  const twice = encodeCardPng(once, JSON.stringify({ name: "New" }), "chara");
  const d = decodeCardPng(twice);
  assert.equal(JSON.parse(d.json).name, "New");
  assert.equal(d.chunks.filter((c) => c.keyword === "chara").length, 1);
  assert.equal(d.chunks.filter((c) => c.keyword === "name").length, 1);
});

test("unrelated text chunks are kept unless asked otherwise", () => {
  const withSoftware = insertText(BLANK_PNG, "Software", "SomeEditor 1.0");
  const kept = decodeCardPng(encodeCardPng(withSoftware, "{}", "chara"));
  assert.ok(kept.chunks.some((c) => c.keyword === "Software"), "kept by default");
  const dropped = decodeCardPng(encodeCardPng(withSoftware, "{}", "chara", false));
  assert.ok(!dropped.chunks.some((c) => c.keyword === "Software"), "dropped when preserveUnknown is false");
});

test("plain (non-base64) JSON in a chunk is read", () => {
  const plain = insertText(BLANK_PNG, "chara", JSON.stringify({ name: "Plain" }));
  assert.equal(JSON.parse(decodeCardPng(plain).json).name, "Plain");
});

test("when a file carries several card chunks, the canonical key wins over a stale one", () => {
  const both = insertText(
    insertText(BLANK_PNG, "character", btoa(JSON.stringify({ name: "Stale" }))),
    "chara", btoa(JSON.stringify({ name: "Canonical" })),
  );
  const d = decodeCardPng(both);
  assert.equal(d.key, "chara");
  assert.equal(JSON.parse(d.json).name, "Canonical");
});

test("a file that is not a PNG, or has no card, decodes to nothing rather than throwing", () => {
  assert.equal(decodeCardPng(new Uint8Array([1, 2, 3])).json, null);
  assert.equal(decodeCardPng(BLANK_PNG).json, null);
  assert.equal(decodeCardPng(new Uint8Array(0)).json, null);
});

test("a chunk declaring an absurd length stops the walk instead of hanging", () => {
  const bad = new Uint8Array(BLANK_PNG);
  new DataView(bad.buffer).setUint32(8, 0xffffffff);   // IHDR length with the high bit set
  const t = Date.now();
  decodeCardPng(bad);
  assert.ok(Date.now() - t < 1000);
});

test("encoding something that is not a PNG, or a PNG missing its data, throws a clear error", () => {
  assert.throws(() => encodeCardPng(new Uint8Array([1, 2, 3]), "{}", "chara"), /Invalid PNG/);
  const noIdat = new Uint8Array([...BLANK_PNG.slice(0, 33), ...BLANK_PNG.slice(BLANK_PNG.length - 12)]);
  assert.throws(() => encodeCardPng(noIdat, "{}", "chara"), /missing IHDR, IDAT or IEND/);
});

test("a corrupt card chunk is reported as corrupt, not as absent", () => {
  const d = decodeCardPng(insertText(BLANK_PNG, "chara", btoa("not json at all")));
  assert.equal(d.json, null);
  assert.equal(d.corruptKey, "chara");
});

test("a corrupt chunk does not hide a good card under another key", () => {
  const png = insertText(insertText(BLANK_PNG, "chara", btoa("garbage")), "character", btoa(JSON.stringify({ name: "Good" })));
  const d = decodeCardPng(png);
  assert.equal(JSON.parse(d.json).name, "Good");
  assert.equal(d.corruptKey, null);
});

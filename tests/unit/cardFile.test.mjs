// Card import parses bytes from outside the app — a downloaded PNG, a
// SillyTavern JSON — so the parser has to survive malformed input. It hung the
// browser tab once: a chunk length with its high bit set read as negative,
// walked the offset backwards, and looped forever. The fixtures here are built
// byte by byte in the test, so there are no binary assets to keep in step.

import { test } from "node:test";
import assert from "node:assert/strict";

const { isPng, decodePngPayload, convertPayload, parseLorebook } =
  await import("../../lib/import/cardFile.ts");

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** A PNG carrying one tEXt chunk, with an explicit length so tests can lie about it. */
function pngWithTextChunk(keyword, text, { declaredLength } = {}) {
  const data = [...new TextEncoder().encode(keyword), 0, ...new TextEncoder().encode(text)];
  const length = declaredLength ?? data.length;
  const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  return new Uint8Array([
    ...SIGNATURE,
    ...be32(length), ...new TextEncoder().encode("tEXt"), ...data, 0, 0, 0, 0, // crc (unchecked)
    ...be32(0), ...new TextEncoder().encode("IEND"), 0, 0, 0, 0,
  ]);
}

const CARD = {
  spec: "chara_card_v2",
  data: { name: "Ash", description: "A swimmer.", personality: "Wry.", tags: ["swim"] },
};
const base64 = (obj) => Buffer.from(JSON.stringify(obj), "utf8").toString("base64");

test("a signature check that only accepts PNGs", () => {
  assert.equal(isPng(new Uint8Array(SIGNATURE)), true);
  assert.equal(isPng(new Uint8Array([1, 2, 3])), false);
  assert.equal(isPng(new Uint8Array()), false);
});

test("a valid v2 card in a base64 tEXt chunk is read back", () => {
  const payload = decodePngPayload(pngWithTextChunk("chara", base64(CARD)));
  assert.ok(payload, "payload should be found");
  const card = convertPayload(payload.json, payload.key);
  assert.equal(card.kind, "character");
  assert.equal(card.draft.name, "Ash");
  assert.equal(card.draft.description, "A swimmer.");
});

test("plain (un-base64'd) JSON in the chunk is also accepted", () => {
  const payload = decodePngPayload(pngWithTextChunk("chara", JSON.stringify(CARD)));
  assert.equal(convertPayload(payload.json, payload.key).draft.name, "Ash");
});

test("a chunk length with the high bit set returns instead of looping", () => {
  // 0xFF000000 read as a signed int is negative — the bug that hung the tab.
  const png = pngWithTextChunk("chara", base64(CARD), { declaredLength: 0xff000000 });
  assert.equal(decodePngPayload(png), null);
});

test("a truncated PNG returns instead of reading past the end", () => {
  const full = pngWithTextChunk("chara", base64(CARD));
  assert.equal(decodePngPayload(full.slice(0, full.length - 30)), null);
});

test("a PNG with no card chunk is simply not a card", () => {
  assert.equal(decodePngPayload(pngWithTextChunk("Comment", "made with a paint program")), null);
});

test("a lorebook payload is recognised as a lorebook, not a character", () => {
  const book = parseLorebook({ name: "Harbor", entries: [{ keys: ["docks"], content: "The old docks." }] });
  assert.ok(book);
  assert.equal(book.entries.length, 1);
});

// A v2 card whose `data` is null used to reach convertPayload's own unwrap,
// which cast without checking and then read `character_book` off null.
test("a v2 card with a null data field falls back to the flat object", () => {
  const result = convertPayload({ spec: "chara_card_v2", data: null, name: "Ash" }, null);
  assert.equal(result.kind, "character");
  assert.equal(result.draft.name, "Ash");
  assert.equal(result.embeddedBook, undefined);
});

test("a v2 card with no data field at all is still readable", () => {
  const result = convertPayload({ spec: "chara_card_v2", name: "Briar" }, null);
  assert.equal(result.kind, "character");
  assert.equal(result.draft.name, "Briar");
});

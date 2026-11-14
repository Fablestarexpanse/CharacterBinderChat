// Trading-card export: the bundle rides next to the card in its own chunk,
// survives a card re-encode, is checked on the way in, and the card face's
// text helpers wrap and shorten as they should.

import { test } from "node:test";
import assert from "node:assert/strict";

const { BLANK_PNG, decodeCardPng, encodeCardPng, readTextChunk, withTextChunk } = await import("../../lib/cards/png.ts");
const { BUNDLE_KEY, MAX_BUNDLE_REFERENCES, bundleImage, bundleJson, bytesToBase64, cleanBundle, sniffImage } = await import("../../lib/cards/bundle.ts");
const { cardTagline, cardTheme, cardTypeLine, wrapLines } = await import("../../lib/cards/tradingCard.ts");

const card = JSON.stringify({ spec: "chara_card_v2", spec_version: "2.0", data: { name: "Zoë", description: "d" } });

test("the bundle sits beside the card: card readers still find the card, and re-encoding the card keeps the bundle", () => {
  const png = encodeCardPng(BLANK_PNG, card, "chara");
  const bundle = bundleJson({ portrait: bundleImage(BLANK_PNG), openers: [{ name: "Rain", text: "It's raining, {{user}}." }] });
  const withBundle = withTextChunk(png, BUNDLE_KEY, bundle);
  assert.equal(decodeCardPng(withBundle).json, card);
  assert.equal(readTextChunk(withBundle, BUNDLE_KEY), bundle);
  const again = encodeCardPng(withBundle, card.replace("Zoë", "Zoe"), "chara");
  assert.equal(readTextChunk(again, BUNDLE_KEY), bundle, "an unknown chunk is preserved");
  const replaced = withTextChunk(withBundle, BUNDLE_KEY, "{}");
  assert.equal(readTextChunk(replaced, BUNDLE_KEY), "{}", "replaced, not appended");
  assert.equal(decodeCardPng(replaced).chunks.filter((c) => c.keyword === BUNDLE_KEY).length, 1);
  assert.throws(() => withTextChunk(png, "chara", "{}"), /card keyword/);
  assert.equal(readTextChunk(png, BUNDLE_KEY), null);
});

test("a bundle from a file is checked: images by their bytes, counts capped, bad entries dropped", () => {
  assert.equal(cleanBundle({ spec: "other" }), null);
  assert.equal(sniffImage(new TextEncoder().encode("<svg xmlns=")), null);
  const svg = bytesToBase64(new TextEncoder().encode("<svg></svg>"));
  const png = bytesToBase64(BLANK_PNG);
  const b = cleanBundle({
    spec: "fablechat_bundle_v1",
    portrait: { type: "image/png", data: svg },
    references: [...Array.from({ length: 12 }, () => ({ type: "image/svg+xml", data: png })), { data: "%%%" }],
    openers: [{ name: "", text: "Hello" }, { name: "x", text: "   " }, "nope", { name: 5, text: "Hi" }],
  });
  assert.equal(b.portrait, undefined, "an SVG is never a portrait");
  assert.equal(b.references.length, MAX_BUNDLE_REFERENCES);
  assert.equal(b.references[0].type, "image/png", "the bytes decide the type");
  assert.deepEqual(b.openers, [{ name: "First message", text: "Hello" }, { name: "First message", text: "Hi" }]);
  assert.equal(bundleJson({}), null, "nothing to carry: no chunk");
});

test("the card face text: a short tagline, a type line, wrapping with an ellipsis, a stable colour", () => {
  const t = cardTagline({ name: "June", description: "{{char}} runs the *night shift* at the radio station. She knows every caller by voice. She has never met one. Long after." }, 120);
  assert.equal(t, "June runs the night shift at the radio station. She knows every caller by voice.");
  assert.ok(cardTagline({ name: "A", description: "x".repeat(400) }, 100).length <= 100);
  assert.equal(cardTagline({ name: "A", description: "" }), "");
  assert.equal(cardTypeLine(["noir", " radio ", "", "night", "slow burn", "extra"]), "Character — noir · radio · night · slow burn");
  assert.equal(cardTypeLine([]), "Character");
  const lines = wrapLines("one two three four five six seven", 9, (s) => s.length, 2);
  assert.deepEqual(lines, ["one two", "three…"]);
  assert.deepEqual(wrapLines("supercalifragilistic", 5, (s) => s.length, 3), ["supercalifragilistic"], "a long word still gets a line");
  assert.equal(cardTheme("June").name, cardTheme("June").name);
});

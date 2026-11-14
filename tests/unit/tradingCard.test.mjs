// Trading-card export: the bundle rides next to the card in its own chunk,
// survives a card re-encode, is checked on the way in, and the card face's
// text helpers wrap and shorten as they should.

import { test } from "node:test";
import assert from "node:assert/strict";

const { BLANK_PNG, decodeCardPng, encodeCardPng, readTextChunk, withTextChunk } = await import("../../lib/cards/png.ts");
const { BUNDLE_KEY, MAX_BUNDLE_REFERENCES, bundleImage, bundleJson, bytesToBase64, cleanBundle, sniffImage } = await import("../../lib/cards/bundle.ts");
const { cardTagline, cardTheme, wrapLines } = await import("../../lib/cards/tradingCard.ts");
const { CARD_ART_SIZE, cardArtVariables, cardMossLayout, cardMossVariables, cleanCardOptions, shortTagline, tidyPrompt } = await import("../../lib/cards/cardArt.ts");
const { compileLayout } = await import("../../lib/media/comicPage.ts");
const { renderTemplate } = await import("../../lib/prompts/render.ts");
const { PROMPTS } = await import("../../lib/prompts/defaults.ts");

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

test("the card face text: a short tagline, wrapping with an ellipsis, a stable colour", () => {
  const t = cardTagline({ name: "June", description: "{{char}} runs the *night shift* at the radio station. She knows every caller by voice. She has never met one. Long after." }, 120);
  assert.equal(t, "June runs the night shift at the radio station. She knows every caller by voice.");
  assert.ok(cardTagline({ name: "A", description: "x".repeat(400) }, 100).length <= 100);
  assert.equal(cardTagline({ name: "A", description: "" }), "");
  const lines = wrapLines("one two three four five six seven", 9, (s) => s.length, 2);
  assert.deepEqual(lines, ["one two", "three…"]);
  assert.deepEqual(wrapLines("supercalifragilistic", 5, (s) => s.length, 3), ["supercalifragilistic"], "a long word still gets a line");
  assert.equal(cardTheme("June").name, cardTheme("June").name);
});

test("card options from anywhere are made safe; unknown styles fall back, custom text is kept and capped", () => {
  assert.deepEqual(cleanCardOptions(null), { engine: "moss", style: "painted", frame: "none", text: "name", nameAt: "bottom" });
  const o = cleanCardOptions({ engine: "look", style: "custom", customStyle: "  ukiyo-e   print ", frame: "bogus", text: "none", nameAt: "top", extra: "x".repeat(900) });
  assert.equal(o.engine, "look");
  assert.equal(o.customStyle, "ukiyo-e print");
  assert.equal(o.frame, "none");
  assert.equal(o.extra.length, 400);
  assert.equal(cardArtVariables(o).style, "ukiyo-e print");
  assert.equal(cardArtVariables({ ...o, customStyle: "" }).style.length > 0, true, "an empty custom style falls back to a preset");
});

test("a MOSS card lays out one figure and letters only the name (and tagline) it was given", () => {
  const person = { name: "Sefa Vire", look: "tall elf woman, silver hair", tagline: shortTagline("An elven arcanist of the Tower of Glass. Centuries young.") };
  assert.equal(person.tagline, "An elven arcanist of the Tower of Glass.");
  const base = cleanCardOptions({});
  for (const opts of [base, { ...base, nameAt: "top" }, { ...base, text: "name-tagline" }, { ...base, text: "name-tagline", nameAt: "top" }, { ...base, text: "none" }]) {
    const vars = cardMossVariables(opts, person);
    const def = PROMPTS.find((p) => p.id === "image.card-moss");
    const caption = tidyPrompt(renderTemplate(def.template, vars));
    const layout = cardMossLayout(opts, person, caption);
    assert.deepEqual([layout.width, layout.height], [CARD_ART_SIZE.moss.width, CARD_ART_SIZE.moss.height]);
    const compiled = JSON.parse(compileLayout(layout));   // throws if a box leaves the card
    const texts = compiled.items.filter((i) => i.label === "text").map((i) => i.text);
    const figure = layout.items.find((i) => i.label === "character").bbox;
    for (const t of layout.items.filter((i) => i.label === "text")) {
      assert.ok(t.bbox[3] <= figure[1] || t.bbox[1] >= figure[3], "lettering never sits on the figure");
    }
    if (opts.text === "none") { assert.deepEqual(texts, []); assert.match(caption, /no text anywhere/); }
    else assert.equal(texts[0], "Sefa Vire");
    if (opts.text === "name-tagline") assert.equal(texts[1], person.tagline);
    assert.doesNotMatch(caption, /,\s*,|\.\s*\./);
  }
});

test("empty prompt variables leave no stray commas", () => {
  assert.equal(tidyPrompt("art, painted, , background: , , no text,"), "art, painted, background:, no text");
  const def = PROMPTS.find((p) => p.id === "image.card-art");
  const p = tidyPrompt(renderTemplate(def.template, cardArtVariables(cleanCardOptions({ engine: "look" }))));
  assert.doesNotMatch(p, /,\s*,/);
  assert.match(p, /no text/);
});

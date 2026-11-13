// Comic-it: the model's script is cleaned, the page is laid out by code, and
// the Layout compiles to MOSS-Image's centred yxyx form exactly as the official
// compiler would.

import { test } from "node:test";
import assert from "node:assert/strict";

const C = await import("../../lib/media/comicPage.ts");
const people = [{ name: "June Okafor", look: "tall dark-skinned woman, copper-tipped short hair, gold hoops" }, { name: "Nora Vale", look: "slim woman, auburn bob, camera on a strap" }];

test("the script is cleaned: unknown people dropped, stage directions out, at most six panels and two balloons", () => {
  const raw = { title: "Night call", panels: [
    { shot: "June at the mic", characters: ["June", "Ghost"], balloons: [{ speaker: "june", text: "*leans in* \"You're on the air.\"" }, { speaker: "Ghost", text: "boo" }, { speaker: "Nora", text: "Hi (nervous)" }, { speaker: "June", text: "third" }] },
    ...Array.from({ length: 8 }, (_, i) => ({ shot: `panel ${i + 2}` })),
    { characters: ["June"] },
  ] };
  const s = C.cleanComicScript(raw, people);
  assert.equal(s.panels.length, 6);
  assert.deepEqual(s.panels[0].balloons, [{ speaker: "June Okafor", text: "You're on the air." }, { speaker: "Nora Vale", text: "Hi" }]);
  assert.deepEqual(s.panels[0].characters, ["June Okafor", "Nora Vale"], "speakers are on panel; unknown people are not");
  assert.equal(C.cleanComicScript({ panels: [] }, people), null);
  assert.equal(C.cleanComicScript("nonsense", people), null);
});

test("panels tile the page inside the margin, in reading order, without overlapping", () => {
  for (let n = 1; n <= 6; n++) {
    const boxes = C.panelBoxes(n);
    assert.equal(boxes.length, n);
    for (const [x1, y1, x2, y2] of boxes) {
      assert.ok(x1 >= 16 && y1 >= 16 && x2 <= 1008 && y2 <= 1520, `n=${n}`);
    }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = boxes[i], b = boxes[j];
      assert.ok(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1], `panels ${i} and ${j} overlap (n=${n})`);
    }
  }
  assert.deepEqual(C.tiers(5), [2, 1, 2]);
});

test("the page carries every look, the lettering rule and each line, inside its panel", () => {
  const s = C.cleanComicScript({ setting: "a radio booth at night", panels: [
    { shot: "close on June", characters: ["June"], balloons: [{ speaker: "June", text: "It's twenty past two and you're on the air, who's this?" }], caption: "Port Ellery, 2:20 a.m." },
    { shot: "Nora on the phone", characters: ["Nora"], balloons: [{ speaker: "Nora", text: "Hi. It's Nora." }] },
  ] }, people);
  const d = C.layoutComicPage(s, people, "");
  assert.match(d.summary.caption, /copper-tipped short hair/);
  assert.match(d.summary.caption, /auburn bob/);
  assert.match(d.summary.caption, /spelled exactly as given/);
  const drawn = d.items.filter((i) => i.label !== "text").map((i) => i.caption).join(" ") + d.summary.caption;
  assert.equal(/June|Nora|Okafor|Vale/.test(drawn), false, "no name reaches the picture, only looks");
  assert.equal(d.summary.canvas, "multi_panel");
  const texts = d.items.filter((i) => i.label === "text");
  assert.equal(texts.length, 3);
  assert.ok(texts[0].text.includes("\n"), "a long line is wrapped to fit its balloon");
  const panels = d.items.filter((i) => i.label === "object").map((i) => i.bbox);
  const inside = (b, p) => b[0] >= p[0] && b[1] >= p[1] && b[2] <= p[2] && b[3] <= p[3];
  assert.ok(texts.slice(0, 2).every((t) => inside(t.bbox, panels[0])));
  assert.ok(inside(texts[2].bbox, panels[1]));
});

test("compiling moves boxes to the centre in yxyx, like the official compiler", () => {
  const d = { width: 1536, height: 1024, bbox_coord_space: "abs", bbox_format: "xyxy", summary: { caption: "cup", meta: [], canvas: "multi_panel" },
    items: [{ label: "object", caption: "cup", bbox: [176, 224, 800, 864] }] };
  const out = JSON.parse(C.compileLayout(d));
  assert.deepEqual(out.items[0].bbox, [-288, -592, 352, 32], "the skill's worked example");
  assert.equal(out.bbox_coord_space, "abs_centralized");
  assert.equal("width" in out, false);
  assert.throws(() => C.compileLayout({ ...d, items: [{ label: "object", caption: "x", bbox: [0, 0, 2000, 10] }] }), /outside/);
});

test("without image tags, a look comes from the description's appearance", () => {
  assert.equal(C.lookFromDescription("A courier.\n\nAppearance: tall, shaved head, red coat.\n\nBackground: long."), "tall, shaved head, red coat.");
  assert.match(C.lookFromDescription("Nora, 28, a photographer. Slight, freckled, with a messy auburn bob and a green waxed jacket. Curious and shy."), /^Slight, freckled, with a messy auburn bob/);
});

test("an action is not a balloon, but a short spoken word is", () => {
  const s = C.cleanComicScript({ panels: [{ shot: "Elias turns", characters: ["June"], balloons: [{ speaker: "June", text: "sigh." }, { speaker: "June", text: "Mm." }] }] }, people);
  assert.deepEqual(s.panels[0].balloons.map((b) => b.text), ["Mm."]);
});

test("a panel with the same people as the one before asks for a different shot", () => {
  const s = C.cleanComicScript({ panels: [
    { shot: "June at the mic", characters: ["June", "Nora"] },
    { shot: "June talks", characters: ["Nora", "June"] },
    { shot: "Nora alone", characters: ["Nora"] },
  ] }, people);
  const panels = C.layoutComicPage(s, people, "").items.filter((i) => i.label === "object").map((i) => i.caption);
  assert.doesNotMatch(panels[0], /different camera angle/);
  assert.match(panels[1], /different camera angle/);
  assert.doesNotMatch(panels[2], /different camera angle/);
});

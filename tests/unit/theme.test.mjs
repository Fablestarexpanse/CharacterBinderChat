// The recolor logic is pure, so these pin the behaviour that matters to a
// person picking colours: bad input never reaches the DOM, and whatever they
// pick still yields readable buttons in both schemes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./_load.mjs";

const { normalizeHex, accentVars, contrast, resolveTheme, accentHex, isDark, buildThemeCache, ACCENT_PRESETS, DEFAULT_THEME } =
  await load("lib/theme.ts");

test("normalizeHex accepts 3/6 digit forms and rejects junk", () => {
  assert.equal(normalizeHex("#ABC"), "#aabbcc");
  assert.equal(normalizeHex("7c5cbf"), "#7c5cbf");
  assert.equal(normalizeHex("  #7C5CBF "), "#7c5cbf");
  for (const bad of ["", "#12", "#12345", "#gggggg", "red", "#7c5cbf; background:url(x)"]) {
    assert.equal(normalizeHex(bad), null, bad);
  }
});

test("every preset keeps white text readable (>= 4.5:1) in both schemes", () => {
  for (const p of ACCENT_PRESETS) {
    for (const dark of [false, true]) {
      const v = accentVars(p.hex, dark);
      assert.ok(contrast(v["--purple"], "#ffffff") >= 4.5, `${p.id} dark=${dark}`);
    }
  }
});

test("a pale custom colour is darkened until white text is readable", () => {
  const v = accentVars("#ffff00", false);
  assert.notEqual(v["--purple"], "#ffff00");
  assert.ok(contrast(v["--purple"], "#ffffff") >= 4.5);
});

test("invalid colour falls back instead of emitting garbage CSS", () => {
  const v = accentVars("not-a-colour", false);
  assert.match(v["--purple"], /^#[0-9a-f]{6}$/);
});

test("the default theme reproduces the original palette's accent", () => {
  assert.equal(accentVars(accentHex(DEFAULT_THEME), false)["--purple"], "#7c5cbf");
});

test("system mode follows the OS; explicit modes ignore it", () => {
  assert.equal(isDark("system", true), true);
  assert.equal(isDark("system", false), false);
  assert.equal(isDark("light", true), false);
  assert.equal(isDark("dark", false), true);
  assert.equal(resolveTheme({ ...DEFAULT_THEME, mode: "system" }, true).dark, true);
});

test("unknown accent id falls back to the first preset", () => {
  assert.equal(accentHex({ ...DEFAULT_THEME, accentId: "nope" }), ACCENT_PRESETS[0].hex);
});

test("the cache carries both schemes so the pre-paint script needs no maths", () => {
  const c = buildThemeCache({ ...DEFAULT_THEME, mode: "system", accentId: "ocean" });
  assert.equal(c.mode, "system");
  assert.ok(c.light["--purple"] && c.dark["--purple-light"]);
  assert.notEqual(c.light["--purple-light"], c.dark["--purple-light"]);
});

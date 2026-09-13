// Dropping files onto the app. Everything here arrives from outside — a
// downloaded card, a renamed screenshot, a truncated JSON file — and the rule
// is that one bad file reports itself and the rest still import. The branches
// asserted are the ones that do not touch the store, so this runs without a
// browser: the store-writing paths are exercised by driving the running app.

import { test } from "node:test";
import assert from "node:assert/strict";

const { importCardFiles } = await import("../../lib/import/applyCards.ts");

const fileOf = (name, content, type = "") => new File([content], name, { type });

test("a file that is neither PNG nor JSON is reported, not thrown", async () => {
  const [result] = await importCardFiles([fileOf("notes.txt", "hello")]);

  assert.equal(result.ok, false);
  assert.equal(result.file, "notes.txt");
  assert.match(result.message, /not a PNG card or JSON file/);
});

test("malformed JSON degrades to a reported failure", async () => {
  // The parse inside decodeFile has no try/catch of its own; the per-file
  // handler in importCardFiles is what keeps it from taking the whole drop
  // down, which is why this assertion is here and not a security finding.
  const [result] = await importCardFiles([fileOf("card.json", "{not json", "application/json")]);

  assert.equal(result.ok, false);
  assert.match(result.message, /^import failed:/);
});

test("a PNG with no embedded card data says what is wrong with it", async () => {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const [result] = await importCardFiles([fileOf("photo.png", signature, "image/png")]);

  assert.equal(result.ok, false);
  assert.match(result.message, /no embedded card data|not a PNG card/);
});

test("one bad file does not stop the ones after it", async () => {
  const results = await importCardFiles([
    fileOf("first.txt", "nope"),
    fileOf("second.json", "{also not json", "application/json"),
    fileOf("third.txt", "nope either"),
  ]);

  assert.equal(results.length, 3, "every file gets a result of its own");
  assert.deepEqual(results.map((r) => r.file), ["first.txt", "second.json", "third.txt"]);
  assert.ok(results.every((r) => r.ok === false));
});

test("an empty drop is an empty list, not an error", async () => {
  assert.deepEqual(await importCardFiles([]), []);
});

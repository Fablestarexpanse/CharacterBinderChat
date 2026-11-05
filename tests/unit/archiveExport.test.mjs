// Library archives must round-trip: export a library, import it into an empty one,
// get the same library back. The zip is also checked by an independent reader
// (Python's zipfile) so the writer is not only agreeing with its own reader.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const { writeZip } = await import("../../lib/cards/zipWrite.ts");
const { buildArchive, uniqueName } = await import("../../lib/cards/archive.ts");
const { readZip } = await import("../../lib/cards/zip.ts");
const { planArchive, applyArchive } = await import("../../lib/import/archive.ts");
const { characterToCard, lorebookToCard, personaToCard, scenarioToCard } = await import("../../lib/cards/tavern.ts");
const { encodeCardPng, BLANK_PNG } = await import("../../lib/cards/png.ts");
const { useFableStore } = await import("../../lib/store/index.ts");

const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
beforeEach(() => useFableStore.setState({ characters: [], lorebooks: [], personas: [], scenarios: [], activePersonaId: null }));

test("what the writer writes, the reader reads back byte for byte, including UTF-8 names", async () => {
  const files = [{ name: "cards/Léa 🌙.json", data: enc({ a: 1 }) }, { name: "cards/x.png", data: BLANK_PNG }, { name: "empty.txt", data: new Uint8Array(0) }];
  const back = await readZip(writeZip(files));
  assert.deepEqual(back.map((e) => e.name), files.map((f) => f.name));
  back.forEach((e, i) => assert.deepEqual([...e.data], [...files[i].data]));
});

test("an independent reader (Python's zipfile) accepts the archive and its CRCs", { skip: spawnSync("python3", ["--version"]).status !== 0 && "no python3" }, () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zipw-")), "a.zip");
  fs.writeFileSync(file, writeZip([{ name: "cards/Léa.json", data: enc({ hello: "world" }) }, { name: "b.png", data: BLANK_PNG }]));
  const r = spawnSync("python3", ["-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); bad=z.testzip(); print(bad); print(','.join(z.namelist()))", file], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const [bad, names] = r.stdout.trim().split("\n");
  assert.equal(bad, "None", "every CRC checks out");
  assert.equal(names, "cards/Léa.json,b.png");
});

test("names are unique within an archive, case-insensitively, and never empty", () => {
  const used = new Set();
  assert.equal(uniqueName("Rook", "1", used), "Rook");
  assert.equal(uniqueName("rook", "2", used), "rook (2)");
  assert.equal(uniqueName("Rook", "3", used), "Rook (3)");
  assert.equal(uniqueName("///", "char-x", used), "char-x", "a name with nothing usable falls back to the id");
  assert.equal(uniqueName("Léa", "4", used), "Léa", "letters outside ASCII are kept");
});

test("a library exported as an archive imports into an empty library as the same library", async () => {
  const now = "2026-01-01T00:00:00.000Z";
  const ash = { id: "ash", name: "Ash", description: "A courier.", tags: ["noir"], systemPrompt: "Stay terse.", createdAt: now, updatedAt: now };
  const rook1 = { id: "r1", name: "Rook", description: "The first.", tags: [], createdAt: now, updatedAt: now };
  const rook2 = { id: "r2", name: "Rook", description: "The second.", tags: [], createdAt: now, updatedAt: now };
  const book = { id: "lb", name: "Harbor", createdAt: now, entries: [{ id: "e", lorebookId: "lb", key: "dock", value: "Gulls.", enabled: true, selective: true, secondaryKeys: ["night"] }] };
  const items = [
    { id: ash.id, kind: "character", name: ash.name, tags: ash.tags, bytes: encodeCardPng(BLANK_PNG, JSON.stringify(characterToCard(ash)), "chara"), ext: "png" },
    { id: rook1.id, kind: "character", name: rook1.name, bytes: enc(characterToCard(rook1)), ext: "json" },
    { id: rook2.id, kind: "character", name: rook2.name, bytes: enc(characterToCard(rook2)), ext: "json" },
    { id: "p", kind: "persona", name: "Kira", bytes: enc(personaToCard({ name: "Kira", description: "Me." })), ext: "json" },
    { id: book.id, kind: "lorebook", name: book.name, bytes: enc(lorebookToCard(book)), ext: "json" },
    { id: "s", kind: "scenario", name: "Storm", bytes: enc(scenarioToCard({ name: "Storm", scenario: "A gale.", firstMessage: "Thunder." })), ext: "json" },
  ];
  const zip = buildArchive(items);

  const entries = await readZip(zip);
  const manifest = JSON.parse(new TextDecoder().decode(entries.find((e) => e.name === "manifest.json").data));
  assert.equal(manifest.length, 6);
  assert.deepEqual(manifest.filter((m) => m.name === "Rook").map((m) => m.file).sort(), ["cards/Rook (2).json", "cards/Rook.json"], "two Rooks, two files");

  const tally = await applyArchive(planArchive(entries), async () => null);
  assert.deepEqual([tally.characters, tally.personas, tally.lorebooks, tally.scenarios, tally.duplicates, tally.skipped.length], [3, 1, 1, 1, 0, 0]);
  const st = useFableStore.getState();
  assert.equal(st.characters.find((c) => c.name === "Ash").systemPrompt, "Stay terse.", "card fields survive");
  assert.deepEqual(st.characters.filter((c) => c.name === "Rook").map((c) => c.description).sort(), ["The first.", "The second."]);
  assert.deepEqual(st.lorebooks[0].entries[0].secondaryKeys, ["night"]);
  assert.equal(st.scenarios[0].firstMessage, "Thunder.");

  const again = await applyArchive(planArchive(await readZip(zip)), async () => null);
  assert.equal(again.duplicates, 6, "importing the same archive twice adds nothing");
});

test("a character's embedded book links the identical one already there instead of forking it", async () => {
  const now = "2026-01-01T00:00:00.000Z";
  const book = { id: "lb", name: "Harbor", createdAt: now, entries: [{ id: "e", lorebookId: "lb", key: "dock", value: "Gulls.", enabled: true }] };
  const owner = { id: "o", name: "Ash", description: "A courier.", tags: [], createdAt: now, updatedAt: now };
  const { loreToCharacterBook } = await import("../../lib/cards/tavern.ts");
  const items = [
    { id: owner.id, kind: "character", name: owner.name, bytes: enc(characterToCard(owner, loreToCharacterBook(book.name, undefined, book.entries))), ext: "json" },
    { id: book.id, kind: "lorebook", name: book.name, bytes: enc(lorebookToCard(book)), ext: "json" },
  ];
  const tally = await applyArchive(planArchive(await readZip(buildArchive(items))), async () => null);
  const st = useFableStore.getState();
  assert.equal(st.lorebooks.length, 1, "one Harbor, not two");
  assert.equal(tally.duplicates, 1, "the standalone copy is recognised as the embedded one");
  assert.equal(st.characters[0].lorebookId, st.lorebooks[0].id, "and the character is linked to it");

  // A book that shares the name but not the entries is a different book
  useFableStore.setState({ characters: [], lorebooks: [{ ...book, id: "other", entries: [{ ...book.entries[0], value: "Crows." }] }] });
  await applyArchive(planArchive(await readZip(buildArchive(items.slice(0, 1)))), async () => null);
  assert.equal(useFableStore.getState().lorebooks.length, 2);
});

test("an empty lorebook exported from the library imports back; an empty embedded book does not appear", async () => {
  const empty = { id: "m", name: "Mountains", description: "Later.", createdAt: "2026-01-01T00:00:00.000Z", entries: [] };
  const tally = await applyArchive(planArchive(await readZip(buildArchive([{ id: "m", kind: "lorebook", name: "Mountains", bytes: enc(lorebookToCard(empty)), ext: "json" }]))), async () => null);
  assert.deepEqual([tally.lorebooks, tally.skipped.length], [1, 0]);
  assert.equal(useFableStore.getState().lorebooks[0].description, "Later.");
  const { parseLorebook } = await import("../../lib/import/cardFile.ts");
  assert.equal(parseLorebook({ name: "X", entries: [] }), null, "embedded: absent");
});

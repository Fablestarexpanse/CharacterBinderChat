// Copies of chat media in a folder you choose: the folder is checked before it
// is kept, names are safe on every system, copies land per character, and a
// copy that cannot be written never stops the picture from being stored.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fable-mediafolder-"));
process.env.FABLE_DB_PATH = path.join(tmp, "t.db");
const F = await import("../../lib/server/mediaFolder.ts");
const { getStore } = await import("../../lib/db/index.ts");

test("off by default; a folder is checked, created and kept; null turns copies off", async () => {
  assert.deepEqual(F.getMediaFolder(), { folder: null, byCharacter: true });
  assert.match((await F.setMediaFolder({ folder: "relative/dir" })).error, /full path/);
  const target = path.join(tmp, "media out");
  const r = await F.setMediaFolder({ folder: `"${target}"` });
  assert.ok(r.ok, r.error);
  assert.equal(r.settings.folder, path.resolve(target), "quotes from a pasted path are dropped");
  assert.ok(fs.statSync(target).isDirectory(), "the folder is created");
  assert.deepEqual(fs.readdirSync(target), [], "the write probe is cleaned up");
  assert.equal((await F.setMediaFolder({ byCharacter: false })).settings.folder, path.resolve(target), "changing one part keeps the other");
  assert.equal((await F.setMediaFolder({ folder: null })).settings.folder, null);
});

test("names are one safe path segment", () => {
  assert.equal(F.safeSegment("Ronan"), "Ronan");
  assert.equal(F.safeSegment("../../etc/passwd"), "etc passwd");
  assert.equal(F.safeSegment("a:b*c?"), "a b c");
  assert.equal(F.safeSegment("CON"), "media");
  assert.equal(F.safeSegment("   ...  "), "media");
});

test("a copy lands in the character's folder, dated and named; off writes nothing", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  assert.equal(await F.saveCopy(png, "image/png", "ab".repeat(32)), null, "no folder, no copy");
  const target = path.join(tmp, "copies");
  await F.setMediaFolder({ folder: target, byCharacter: true });
  const now = new Date(2026, 10, 5, 14, 32, 7);
  const r = await F.saveCopy(png, "image/png", "b37fe98e" + "0".repeat(56), { who: "Ronan/../x", now });
  assert.equal(r.savedTo, path.join(path.resolve(target), "Ronan x", "2026-11-05_143207_Ronan x_photo_b37fe98e.png"));
  assert.deepEqual(new Uint8Array(fs.readFileSync(r.savedTo)), png);
  const clip = await F.saveCopy(new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]), "video/mp4", "c4".repeat(32), { who: "Ronan", now });
  assert.equal(clip.savedTo, path.join(path.resolve(target), "Ronan", "2026-11-05_143207_Ronan_clip_c4c4c4c4.mp4"));
  await F.setMediaFolder({ byCharacter: false });
  const flat = await F.saveCopy(png, "image/png", "dd".repeat(32), { who: "Kira", now });
  assert.equal(path.dirname(flat.savedTo), path.resolve(target), "one folder for everything when asked");
});

test("a folder that cannot be written reports why instead of failing the picture", async () => {
  const target = path.join(tmp, "gone");
  await F.setMediaFolder({ folder: target });
  fs.rmSync(target, { recursive: true });
  fs.writeFileSync(target, "a file where the folder was");
  const r = await F.saveCopy(new Uint8Array([1]), "image/png", "ee".repeat(32), { who: "Ronan" });
  assert.match(r.saveError, /Could not save a copy/);
  await F.setMediaFolder({ folder: null });
  getStore();
});

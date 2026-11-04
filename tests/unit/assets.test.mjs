// The asset store. What it exists to fix is measured here directly: edits of a
// character with a picture must not copy the picture into every history row. And
// because it accepts uploads: only real images get in, by their bytes.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const { FableStore } = await import("../../lib/db/store.ts");
const { sniffImage, assetUrl, isAssetHash, decodeDataUrl } = await import("../../lib/db/assets.ts");
const { snapWidth, resized, readBodyCapped } = await import("../../lib/server/assets.ts");
const { createCard, updateCard, setAvatar, undo, CardError } = await import("../../lib/server/cards.ts");
const { inspectBackup } = await import("../../lib/db/backup.ts");

/** A real, decodable PNG of the given size (solid colour), built with zlib. */
function png(w, h, seed = 0) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = (c >>> 8) ^ crcTable[(c ^ b) & 0xff]; return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) { row[1 + x * 3] = (x * 7 + seed) & 255; row[2 + x * 3] = (x * 3) & 255; row[3 + x * 3] = seed & 255; }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
const dataUrl = (bytes, mime = "image/png") => `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;

test("images are recognised by their bytes; anything else is refused", () => {
  assert.equal(sniffImage(png(2, 2)), "image/png");
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImage(new TextEncoder().encode("GIF89a")), "image/gif");
  assert.equal(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), "image/webp");
  assert.equal(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")), null, "SVG can carry script");
  assert.equal(sniffImage(new TextEncoder().encode("just text")), null);
});

test("the same image stored twice is one row; it reads back byte for byte", () => {
  const s = new FableStore(":memory:");
  const img = png(4, 4);
  const a = s.putAsset(img), b = s.putAsset(img);
  assert.equal(a.hash, b.hash);
  assert.ok(isAssetHash(a.hash));
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM app_assets").get().n, 1);
  assert.deepEqual(new Uint8Array(s.getAsset(a.hash).bytes), img);
  assert.equal(s.getAsset("../../etc/passwd"), null, "a non-hash is not even looked up");
  assert.throws(() => s.putAsset(new TextEncoder().encode("not an image")), /not an image/);
});

test("inline avatars move into the asset store, through a revision, and only once", () => {
  const s = new FableStore(":memory:");
  const img = png(8, 8);
  s.patchAppState({ upserts: {
    characters: [{ id: "a", name: "A", description: "d", tags: [], avatar: dataUrl(img) }, { id: "b", name: "B", description: "d", tags: [], avatar: "https://example.com/x.png" }],
    personas: [{ id: "p", name: "P", description: "d", avatar: dataUrl(img) }],
  } });
  const rev = s.rev();
  assert.equal(s.migrateInlineAvatars(), 2);
  const a = s.getRow("characters", "a").data;
  assert.match(a.avatar, /^\/api\/assets\/[0-9a-f]{64}$/);
  assert.equal(s.getRow("personas", "p").data.avatar, a.avatar, "identical images share one asset");
  assert.equal(s.getRow("characters", "b").data.avatar, "https://example.com/x.png", "a plain URL is left alone");
  assert.ok(s.rev() > rev, "open tabs will see the change");
  assert.equal(s.migrateInlineAvatars(), 0, "nothing left to do the second time");
});

test("an inline 'image' that is not really one is kept rather than lost", () => {
  const s = new FableStore(":memory:");
  s.patchAppState({ upserts: { characters: [{ id: "a", name: "A", description: "d", tags: [], avatar: "data:image/png;base64," + Buffer.from("nope").toString("base64") }] } });
  assert.equal(s.migrateInlineAvatars(), 0);
  assert.match(s.getRow("characters", "a").data.avatar, /^data:image\/png/);
});

test("garbage collection keeps what rows and undo history refer to, and anything recent", () => {
  const s = new FableStore(":memory:");
  const used = s.putAsset(png(2, 2, 1)).hash, inHistory = s.putAsset(png(2, 2, 2)).hash, orphan = s.putAsset(png(2, 2, 3)).hash, fresh = s.putAsset(png(2, 2, 4)).hash;
  s.db.prepare("UPDATE app_assets SET created_at = 0 WHERE hash != ?").run(fresh);
  s.patchAppState({ upserts: { characters: [{ id: "a", name: "A", description: "d", tags: [], avatar: assetUrl(used) }] } });
  s.saveHistory({ collection: "characters", rowId: "a", data: JSON.stringify({ avatar: assetUrl(inHistory) }), seq: 0, rev: 1, source: "agent" });

  assert.equal(s.gcAssets(), 1);
  const left = new Set(s.db.prepare("SELECT hash FROM app_assets").all().map((r) => r.hash));
  assert.deepEqual([used, inHistory, fresh].every((h) => left.has(h)), true);
  assert.equal(left.has(orphan), false);
});

test("ACCEPTANCE: 40 edits of a character with a picture no longer grow the database by megabytes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fable-assets-")), file = path.join(dir, "t.db");
  const s = new FableStore(file);
  const { id } = createCard(s, "character", { name: "Ash", description: "d" }, "agent");
  setAvatar(s, "character", id, png(400, 400), "agent");          // a real picture, tens of KB
  s.db.pragma("wal_checkpoint(TRUNCATE)");
  const size = () => fs.statSync(file).size + (fs.existsSync(file + "-wal") ? fs.statSync(file + "-wal").size : 0);
  const before = size();
  for (let i = 0; i < 40; i++) updateCard(s, "character", id, { personality: "v" + i }, "agent");
  s.db.pragma("wal_checkpoint(TRUNCATE)");
  const grew = size() - before;
  assert.ok(grew < 200 * 1024, `grew ${(grew / 1024).toFixed(0)} KB; was 6.5 MB with inline images`);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM app_assets").get().n, 1, "the picture is stored once");
  s.close();
});

test("a backup carries the pictures, so a restore does not lose them", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fable-assets-"));
  const s = new FableStore(path.join(dir, "live.db"));
  const { id } = createCard(s, "character", { name: "Ash", description: "d" }, "agent");
  const { avatar } = setAvatar(s, "character", id, png(16, 16), "agent");
  await s.backupTo(path.join(dir, "b.db"));
  assert.equal(inspectBackup(path.join(dir, "b.db")).ok, true);
  const copy = new FableStore(path.join(dir, "b.db"));
  assert.ok(copy.getAsset(avatar.split("/").pop()), "the image is inside the backup file");
  copy.close(); s.close();
});

test("setting a picture through the agent API is recorded and undoable, and only for characters and personas", () => {
  const s = new FableStore(":memory:");
  const { id } = createCard(s, "character", { name: "Ash", description: "d" }, "agent");
  const r = setAvatar(s, "character", id, png(4, 4), "Claude Code");
  assert.match(s.getRow("characters", id).data.avatar, /^\/api\/assets\//);
  assert.match(s.getChangesSince(0).events.at(-1).summary, /Claude Code set the picture of character “Ash”/);
  undo(s, r.historyId, "user");
  assert.equal("avatar" in s.getRow("characters", id).data, false, "undo takes the picture away again");

  assert.throws(() => setAvatar(s, "character", id, new TextEncoder().encode("<svg/>"), "agent"), (e) => e instanceof CardError && /not an image/.test(e.message));
  const lb = createCard(s, "lorebook", { name: "L", entries: [{ keys: ["k"], content: "c" }] }, "agent");
  assert.throws(() => setAvatar(s, "lorebook", lb.id, png(2, 2), "agent"), /only characters and personas/);
});

test("sizes snap to a few stops so requests cannot mint endless variants", () => {
  assert.equal(snapWidth(10), 64);
  assert.equal(snapWidth(80), 128);
  assert.equal(snapWidth(512), 512);
  assert.equal(snapWidth(5000), 1024);
  assert.equal(snapWidth(NaN), null);
  assert.equal(snapWidth(0), null);
});

test("a resized copy is smaller than the original when sharp is available, and absent (not wrong) when it is not", async () => {
  const big = Buffer.from(png(600, 600));
  const out = await resized("h", big, 128);
  if (out === null) return;                                   // no sharp on this platform: the route serves the original
  assert.ok(out.length < big.length);
  assert.equal(out.subarray(8, 12).toString("latin1"), "WEBP");
});

test("an upload is refused as it passes the cap, even with no or a false Content-Length", async () => {
  const stream = new ReadableStream({ start(c) { for (let i = 0; i < 5; i++) c.enqueue(new Uint8Array(1024)); c.close(); } });
  const req = new Request("http://x/api/assets", { method: "POST", body: stream, duplex: "half" });
  await assert.rejects(() => readBodyCapped(req, 3000), /larger than/);
  const ok = await readBodyCapped(new Request("http://x", { method: "POST", body: new Uint8Array(10) }), 3000);
  assert.equal(ok.length, 10);
});

test("data URLs decode; malformed ones do not", () => {
  assert.equal(decodeDataUrl(dataUrl(png(1, 1))).length > 0, true);
  assert.equal(decodeDataUrl("data:text/html;base64,PGI+"), null);
  assert.equal(decodeDataUrl("https://x"), null);
});

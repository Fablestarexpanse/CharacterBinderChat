// ─── Asset storage ────────────────────────────────────────────────────────────
// Content-addressed images in the app_assets table. Database-level only: storing,
// reading, sweeping, and the one-time move of inline data: URLs out of rows. The
// HTTP side (upload limits, resizing) is lib/server/assets.ts.
//
// Why: avatars used to be base64 strings inside character rows. That one string
// was then copied into every undo-history row (40 edits of one character grew the
// database by 6.5 MB), every sync message, every poll response and the browser's
// localStorage, and exports could only use the 512 px copy. A reference is ~80 bytes.

import type { Database as DB } from "better-sqlite3";
import { createHash } from "node:crypto";

export const ASSET_URL_PREFIX = "/api/assets/";
const HASH = /^[0-9a-f]{64}$/;
const REFERENCE = /\/api\/assets\/([0-9a-f]{64})/g;

export const isAssetHash = (s: string) => HASH.test(s);
export const assetUrl = (hash: string) => `${ASSET_URL_PREFIX}${hash}`;

/** The image type, from the bytes themselves (never from what a client claims). null if not an image we accept. */
export function sniffImage(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/gif" | "image/webp" | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  // SVG is deliberately not accepted: it can carry script.
  return null;
}

export function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Store an image. The same bytes stored twice are one row. */
export function putAsset(db: DB, bytes: Uint8Array): { hash: string; mime: string; size: number } {
  const mime = sniffImage(bytes);
  if (!mime) throw new Error("not an image FableChat accepts (PNG, JPEG, GIF or WebP)");
  const hash = hashBytes(bytes);
  db.prepare("INSERT OR IGNORE INTO app_assets (hash, mime, bytes, size, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(hash, mime, Buffer.from(bytes), bytes.length, Math.floor(Date.now() / 1000));
  return { hash, mime, size: bytes.length };
}

export function getAsset(db: DB, hash: string): { mime: string; bytes: Buffer } | null {
  if (!isAssetHash(hash)) return null;
  const r = db.prepare("SELECT mime, bytes FROM app_assets WHERE hash = ?").get(hash) as { mime: string; bytes: Buffer } | undefined;
  return r ?? null;
}

/** Every asset hash mentioned by an app row or by undo history (which can bring an old one back). */
export function referencedAssets(db: DB): Set<string> {
  const out = new Set<string>();
  const tables = ["app_characters", "app_chats", "app_messages", "app_personas", "app_lorebooks", "app_scenarios", "app_presets"];
  const scan = (sql: string) => {
    for (const r of db.prepare(sql).all() as Array<{ data: string | null }>) {
      if (!r.data) continue;
      for (const m of r.data.matchAll(REFERENCE)) out.add(m[1]);
    }
  };
  for (const t of tables) scan(`SELECT data FROM ${t} WHERE data LIKE '%/api/assets/%'`);
  scan("SELECT data FROM app_history WHERE data LIKE '%/api/assets/%'");
  return out;
}

/**
 * Delete assets nothing refers to. Only those older than `graceSeconds`: an image
 * uploaded a moment ago may be sitting in an editor that has not been saved yet.
 */
export function gcAssets(db: DB, graceSeconds = 24 * 3600): number {
  const keep = referencedAssets(db);
  const cutoff = Math.floor(Date.now() / 1000) - graceSeconds;
  const candidates = db.prepare("SELECT hash FROM app_assets WHERE created_at < ?").all(cutoff) as Array<{ hash: string }>;
  const del = db.prepare("DELETE FROM app_assets WHERE hash = ?");
  let n = 0;
  for (const { hash } of candidates) if (!keep.has(hash)) { del.run(hash); n++; }
  return n;
}

/** data:image/...;base64,... → bytes, or null. */
export function decodeDataUrl(url: string): Uint8Array | null {
  const m = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(url);
  if (!m) return null;
  try { return new Uint8Array(Buffer.from(m[1], "base64")); } catch { return null; }
}

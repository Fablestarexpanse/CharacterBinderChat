// ─── A copy of chat media in a folder you choose ──────────────────────────────
// Server-only. Photos and clips made in chats are stored as assets in the
// database (so backup, sync and undo stay one file); this setting writes an
// extra copy of each one to a folder on this computer, optionally one
// sub-folder per character. The database copy is never replaced, and a copy
// that cannot be written never fails the photo or clip: the reason is
// returned so the app can show it.

import fs from "node:fs/promises";
import path from "node:path";
import { getStore } from "@/lib/db";

const KEY = "media:saveFolder";

export interface MediaFolderSettings {
  /** Absolute folder path; null = no copies */
  folder: string | null;
  /** One sub-folder per character */
  byCharacter: boolean;
}

export const DEFAULT_MEDIA_FOLDER: MediaFolderSettings = { folder: null, byCharacter: true };

export function getMediaFolder(): MediaFolderSettings {
  const raw = getStore().getKv(KEY);
  if (!raw) return DEFAULT_MEDIA_FOLDER;
  try {
    const r = JSON.parse(raw) as Partial<MediaFolderSettings>;
    return { folder: typeof r.folder === "string" && r.folder ? r.folder : null, byCharacter: r.byCharacter !== false };
  } catch { return DEFAULT_MEDIA_FOLDER; }
}

/**
 * Check a folder can take copies: an absolute path, created if missing, and
 * writable (a probe file is written and removed). Returns the normalised path.
 */
export async function checkFolder(raw: string): Promise<{ ok: true; folder: string } | { ok: false; error: string }> {
  const p = raw.trim().replace(/^["']|["']$/g, "");
  if (!p) return { ok: false, error: "Give a folder path." };
  if (!path.isAbsolute(p)) return { ok: false, error: "Use a full path, for example F:\\FableChat media or /home/you/FableChat." };
  const folder = path.resolve(p);
  try {
    await fs.mkdir(folder, { recursive: true });
    const probe = path.join(folder, `.fablechat-write-test-${process.pid}`);
    await fs.writeFile(probe, "ok");
    await fs.rm(probe, { force: true });
    return { ok: true, folder };
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return { ok: false, error: code === "EACCES" || code === "EPERM" ? `FableChat may not write to ${folder}.` : `That folder cannot be used: ${(e as Error).message}` };
  }
}

/** Change the setting. A folder is checked before it is kept; null turns copies off. */
export async function setMediaFolder(patch: { folder?: string | null; byCharacter?: boolean }): Promise<{ ok: true; settings: MediaFolderSettings } | { ok: false; error: string }> {
  const cur = getMediaFolder();
  let folder = cur.folder;
  if (patch.folder === null || patch.folder === "") folder = null;
  else if (typeof patch.folder === "string") {
    const c = await checkFolder(patch.folder);
    if (!c.ok) return c;
    folder = c.folder;
  }
  const settings = { folder, byCharacter: typeof patch.byCharacter === "boolean" ? patch.byCharacter : cur.byCharacter };
  getStore().setKv(KEY, JSON.stringify(settings));
  return { ok: true, settings };
}

/** A name that is safe as one path segment on every system: no separators, no dots at the ends, not a device name. */
export function safeSegment(name: string, fallback = "media"): string {
  const s = name.normalize("NFKC").replace(/[<>:"/\\|?*\x00-\x1f]+/g, " ")
    .split(/\s+/).filter((w) => w && !/^\.+$/.test(w)).join(" ")
    .replace(/^\.+|\.+$/g, "").slice(0, 60).trim();
  if (!s || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) return fallback;
  return s;
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/webm": "webm" };

/**
 * Write a copy of a stored picture or clip, when a folder is set.
 * `who` names the character (for the sub-folder and the file name).
 * Returns where it went, nothing when copies are off, or why it failed.
 */
export async function saveCopy(bytes: Uint8Array, mime: string, hash: string, opts: { who?: string; now?: Date } = {}):
  Promise<{ savedTo: string } | { saveError: string } | null> {
  const { folder, byCharacter } = getMediaFolder();
  if (!folder) return null;
  const who = opts.who ? safeSegment(opts.who, "") : "";
  // The folder is yours, chosen at run time: tell the bundler not to trace it (it would trace the whole project)
  const dir = byCharacter && who ? path.join(/*turbopackIgnore: true*/ folder, who) : folder;
  const d = opts.now ?? new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const kind = mime.startsWith("video/") ? "clip" : "photo";
  const file = path.join(dir, `${stamp}_${who ? `${who}_` : ""}${kind}_${hash.slice(0, 8)}.${EXT[mime] ?? "bin"}`);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, bytes, { flag: "wx" }).catch(async (e: NodeJS.ErrnoException) => { if (e.code !== "EEXIST") throw e; });
    return { savedTo: file };
  } catch (e) {
    return { saveError: `Could not save a copy to ${dir}: ${(e as Error).message}` };
  }
}

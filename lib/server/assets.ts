// ─── Assets over HTTP ─────────────────────────────────────────────────────────
// Upload limits and on-request resizing for the asset table (lib/db/assets.ts).
// Server-only.
//
// Resizing uses `sharp` when it is installed. It is an OPTIONAL dependency of Next,
// so a platform without a prebuilt binary simply has no sharp: then the original is
// served at every size. Nothing breaks, avatars just download heavier.

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** A ~5 s clip at 1 MP is a few MB; this leaves room for longer ones. */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

/** The sizes a resized copy may be asked for. Snapping to a few stops requests from minting endless variants. */
export const WIDTHS = [64, 128, 256, 512, 1024] as const;

export function snapWidth(requested: number): number | null {
  if (!Number.isFinite(requested) || requested <= 0) return null;
  return WIDTHS.find((w) => w >= requested) ?? WIDTHS[WIDTHS.length - 1];
}

/**
 * Read a request (or an upstream response) body, refusing it as soon as it passes
 * `max` bytes (a missing or false Content-Length does not help).
 */
export async function readBodyCapped(req: { headers: Headers; body: ReadableStream<Uint8Array> | null }, max: number, what = "that file"): Promise<Uint8Array> {
  const tooBig = () => new Error(`${what} is larger than the ${max >= 1048576 ? `${Math.round(max / 1048576)} MB` : `${Math.round(max / 1024)} KB`} limit`);
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw tooBig();
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { await reader.cancel(); throw tooBig(); }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** Upstream JSON (a model's reply, a service's status) is small: this is far more than any of it needs */
export const MAX_JSON_BYTES = 4 * 1024 * 1024;

/** A JSON body, read with a cap. Null when it is not JSON; throws when it is over the cap. */
export async function readJsonCapped<T = unknown>(r: { headers: Headers; body: ReadableStream<Uint8Array> | null }, max = MAX_JSON_BYTES, what = "the reply"): Promise<T | null> {
  const bytes = await readBodyCapped(r, max, what);
  try { return JSON.parse(new TextDecoder().decode(bytes)) as T; } catch { return null; }
}

/** Only web addresses are fetched from a URL another service handed back (not file:, data: or anything else) */
export function isWebUrl(u: string): boolean {
  try { const p = new URL(u).protocol; return p === "http:" || p === "https:"; } catch { return false; }
}

type Sharp = (input: Buffer) => { rotate: () => Sharp2; };
type Sharp2 = { resize: (o: object) => { webp: (o: object) => { toBuffer: () => Promise<Buffer> } } };

let sharpLoad: Promise<Sharp | null> | null = null;
function loadSharp(): Promise<Sharp | null> {
  sharpLoad ??= import("sharp").then((m) => (m.default ?? m) as unknown as Sharp).catch(() => null);
  return sharpLoad;
}

/** A small memory cache of recent variants; the browser caches them too (they are immutable). */
const variants = new Map<string, Buffer>();
const MAX_VARIANTS = 300;

/**
 * The image at `width` pixels wide (aspect kept, never enlarged), as WebP. Returns
 * null when it cannot resize (no sharp, or an image sharp cannot read): the caller
 * then serves the original.
 */
export async function resized(hash: string, bytes: Buffer, width: number): Promise<Buffer | null> {
  const key = `${hash}:${width}`;
  const hit = variants.get(key);
  if (hit) return hit;
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    // rotate() applies EXIF orientation, so a phone photo is not served sideways
    const out = await sharp(bytes).rotate().resize({ width, height: width, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    variants.set(key, out);
    if (variants.size > MAX_VARIANTS) variants.delete(variants.keys().next().value as string);
    return out;
  } catch {
    return null;
  }
}

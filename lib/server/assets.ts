// ─── Assets over HTTP ─────────────────────────────────────────────────────────
// Upload limits and on-request resizing for the asset table (lib/db/assets.ts).
// Server-only.
//
// Resizing uses `sharp` when it is installed. It is an OPTIONAL dependency of Next,
// so a platform without a prebuilt binary simply has no sharp: then the original is
// served at every size. Nothing breaks, avatars just download heavier.

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** The sizes a resized copy may be asked for. Snapping to a few stops requests from minting endless variants. */
export const WIDTHS = [64, 128, 256, 512, 1024] as const;

export function snapWidth(requested: number): number | null {
  if (!Number.isFinite(requested) || requested <= 0) return null;
  return WIDTHS.find((w) => w >= requested) ?? WIDTHS[WIDTHS.length - 1];
}

/** Read a request body, refusing it as soon as it passes `max` bytes (a missing or false Content-Length does not help). */
export async function readBodyCapped(req: Request, max: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw new Error(`that file is larger than the ${Math.round(max / 1048576)} MB limit`);
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) { await reader.cancel(); throw new Error(`that file is larger than the ${Math.round(max / 1048576)} MB limit`); }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
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

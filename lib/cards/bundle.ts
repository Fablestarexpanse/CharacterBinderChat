// ─── FableChat card bundle ────────────────────────────────────────────────────
// What a FableChat trading card carries beyond the Tavern V2 card: the plain
// portrait (the PNG itself is the framed card face, which must not become the
// avatar on import), the character's reference pictures, and saved first
// messages chosen at export. It rides in its own tEXt chunk (`fablechat`) so
// SillyTavern and other readers see an ordinary card and ignore it.
//
// Pure: no DOM. A bundle read from a file is untrusted, so `cleanBundle` checks
// every image by its bytes and caps counts and sizes before anything is stored.

export const BUNDLE_KEY = "fablechat";
export const BUNDLE_SPEC = "fablechat_bundle_v1";

export const MAX_BUNDLE_REFERENCES = 8;
export const MAX_BUNDLE_OPENERS = 50;
/** Per picture, decoded. A portrait or reference is never near this. */
export const MAX_BUNDLE_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_OPENER_TEXT = 20_000;

export type BundleImageType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export interface BundleImage { type: BundleImageType; data: string /* base64 */ }

export interface CardBundle {
  spec: typeof BUNDLE_SPEC;
  portrait?: BundleImage;
  references?: BundleImage[];
  openers?: Array<{ name: string; text: string }>;
}

/** The picture type from its first bytes; never SVG or anything else. */
export function sniffImage(bytes: Uint8Array): BundleImageType | null {
  const at = (i: number, ...b: number[]) => b.every((v, k) => bytes[i + k] === v);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

export function base64ToBytes(b64: string): Uint8Array | null {
  try { return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { return null; }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** A picture for the bundle, or null when the bytes are not an image we keep. */
export function bundleImage(bytes: Uint8Array): BundleImage | null {
  const type = sniffImage(bytes);
  if (!type || bytes.length > MAX_BUNDLE_IMAGE_BYTES) return null;
  return { type, data: bytesToBase64(bytes) };
}

function cleanImage(raw: unknown): BundleImage | null {
  if (!raw || typeof raw !== "object") return null;
  const data = (raw as { data?: unknown }).data;
  if (typeof data !== "string" || data.length > Math.ceil(MAX_BUNDLE_IMAGE_BYTES / 3) * 4 + 4) return null;
  const bytes = base64ToBytes(data);
  if (!bytes) return null;
  // The declared type is ignored: the bytes decide
  return bundleImage(bytes);
}

/** A bundle read from a file, checked; null when it is not one of ours. */
export function cleanBundle(raw: unknown): CardBundle | null {
  if (!raw || typeof raw !== "object" || (raw as { spec?: unknown }).spec !== BUNDLE_SPEC) return null;
  const r = raw as { portrait?: unknown; references?: unknown; openers?: unknown };
  const out: CardBundle = { spec: BUNDLE_SPEC };
  const portrait = cleanImage(r.portrait);
  if (portrait) out.portrait = portrait;
  if (Array.isArray(r.references)) {
    const refs = r.references.slice(0, MAX_BUNDLE_REFERENCES).map(cleanImage).filter((x): x is BundleImage => !!x);
    if (refs.length) out.references = refs;
  }
  if (Array.isArray(r.openers)) {
    const openers = r.openers.slice(0, MAX_BUNDLE_OPENERS).flatMap((o) => {
      if (!o || typeof o !== "object") return [];
      const { name, text } = o as { name?: unknown; text?: unknown };
      if (typeof text !== "string" || !text.trim()) return [];
      return [{ name: (typeof name === "string" && name.trim() ? name.trim() : "First message").slice(0, 120), text: text.slice(0, MAX_OPENER_TEXT) }];
    });
    if (openers.length) out.openers = openers;
  }
  return out;
}

/** The bundle's JSON text, or null when there is nothing in it worth carrying. */
export function bundleJson(b: Omit<CardBundle, "spec">): string | null {
  if (!b.portrait && !b.references?.length && !b.openers?.length) return null;
  return JSON.stringify({ spec: BUNDLE_SPEC, ...b });
}

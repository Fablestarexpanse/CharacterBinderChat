// ─── PNG card codec ───────────────────────────────────────────────────────────
// Reads and writes the card JSON that character-card PNGs carry in a tEXt chunk
// (base64 JSON under a keyword). Pure bytes in, bytes out: no DOM, so the unit
// tests load it directly and the server could use it too.
//
// Ported from CharacterBinder's pngMetadata.ts, which is the codec the card
// License notice: see THIRD_PARTY_NOTICES.md (MIT).
// format was built against. FableChat previously had its own read-only copy;
// this replaces it so there is one implementation, and adds the write side.

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** Keywords a character card may be stored under. Every tool picked its own. */
export const CHARACTER_KEYS = ["chara", "character", "tavern", "tavern_card_v2"] as const;
/** Keywords for the non-character cards CharacterBinder writes. */
export const DATA_KEYS = ["lorebook", "persona", "scenario", "script"] as const;
export const CARD_KEYS: readonly string[] = [...CHARACTER_KEYS, ...DATA_KEYS];

/** A PNG may declare a chunk up to 4 GiB; card art never needs more than this. */
const MAX_CHUNK_LENGTH = 64 * 1024 * 1024;
/** Ordinary PNGs have a handful of chunks; thousands means something is wrong. */
const MAX_CHUNKS = 4096;

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!isPng(bytes) || bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

// ─── CRC ──────────────────────────────────────────────────────────────────────

let crcTable: Uint32Array | null = null;
function table(): Uint32Array {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (crcTable = t);
}

function crc32(data: Uint8Array): number {
  const t = table();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = (crc >>> 8) ^ t[(crc ^ data[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

// ─── Chunks ───────────────────────────────────────────────────────────────────

interface Chunk { type: string; data: Uint8Array }

function readChunks(bytes: Uint8Array): Chunk[] {
  const chunks: Chunk[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    // getUint32, not shifts: `<<` coerces to signed int32, so a length with the
    // high bit set went negative and walked the cursor backwards — an endless
    // loop on a crafted file.
    const length = view.getUint32(offset, false);
    if (length > MAX_CHUNK_LENGTH || length > bytes.length - offset - 12) break;
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    chunks.push({ type, data: bytes.slice(offset + 8, offset + 8 + length) });
    offset += 12 + length;   // every pass consumes >= 12 bytes, so this terminates
    if (type === "IEND" || chunks.length >= MAX_CHUNKS) break;
  }
  return chunks;
}

function chunkBytes(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcInput), false);
  return out;
}

function textChunk(keyword: string, text: string): Uint8Array {
  const enc = new TextEncoder();
  const key = enc.encode(keyword);
  const body = enc.encode(text);
  const data = new Uint8Array(key.length + 1 + body.length);
  data.set(key, 0);
  data.set(body, key.length + 1);      // data[key.length] stays 0: the separator
  return chunkBytes("tEXt", data);
}

/**
 * Keyword and text bytes of a tEXt/iTXt chunk, or null with no separator.
 * iTXt is keyword, NUL, compression flag, method, language, NUL, translated
 * keyword, NUL, then the text; compressed text is not something card tools
 * write, so it reads as empty rather than shipping an inflater for it.
 */
function textPayload(chunk: Chunk): { keyword: string; text: Uint8Array } | null {
  const nul = chunk.data.indexOf(0);
  if (nul === -1) return null;
  const keyword = new TextDecoder().decode(chunk.data.slice(0, nul));
  if (chunk.type !== "iTXt") return { keyword, text: chunk.data.slice(nul + 1) };
  let pos = nul + 1;
  const compressed = chunk.data[pos] !== 0;
  pos += 2;
  for (let i = 0; i < 2; i++) {
    while (pos < chunk.data.length && chunk.data[pos] !== 0) pos++;
    pos++;
  }
  return { keyword, text: compressed ? new Uint8Array(0) : chunk.data.slice(pos) };
}

/** Chunked: spreading a large Uint8Array into fromCharCode overflows the argument limit. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Card JSON inside chunk text: base64 is conventional, plain JSON exists in the wild. */
function payloadJson(text: Uint8Array): string | null {
  const raw = new TextDecoder().decode(text);
  let decoded: string;
  try {
    // Through a UTF-8 round trip so non-ASCII names survive
    decoded = new TextDecoder().decode(Uint8Array.from(atob(raw.trim()), (c) => c.charCodeAt(0)));
  } catch {
    decoded = raw;
  }
  try { JSON.parse(decoded); return decoded; } catch { return null; }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface DecodedPng {
  json: string | null;
  /** Always a keyword this module knows, never an arbitrary chunk name. */
  key: string | null;
  /** Set when a card chunk exists but its payload will not decode. */
  corruptKey: string | null;
  chunks: Array<{ keyword: string; chunkType: string; dataLength: number }>;
}

export function decodeCardPng(bytes: Uint8Array): DecodedPng {
  const out: DecodedPng = { json: null, key: null, corruptKey: null, chunks: [] };
  if (!isPng(bytes)) return out;

  // Preference order, not file order: a card with both a `chara` and a stale
  // `character` chunk should read the canonical one.
  const found = new Map<string, Uint8Array>();
  for (const chunk of readChunks(bytes)) {
    if (chunk.type !== "tEXt" && chunk.type !== "iTXt") continue;
    const p = textPayload(chunk);
    if (!p) continue;
    out.chunks.push({ keyword: p.keyword, chunkType: chunk.type, dataLength: p.text.length });
    if (CARD_KEYS.includes(p.keyword) && !found.has(p.keyword)) found.set(p.keyword, p.text);
  }
  for (const key of CARD_KEYS) {
    const text = found.get(key);
    if (!text) continue;
    const json = payloadJson(text);
    if (json) { out.json = json; out.key = key; out.corruptKey = null; return out; }
    out.corruptKey ??= key;
  }
  return out;
}

/** The card's own name, parsed rather than regex-scraped (escaped quotes, nested book names). */
function cardName(json: string): string | null {
  try {
    const p = JSON.parse(json) as { name?: unknown; data?: { name?: unknown } };
    const n = p?.data?.name ?? p?.name;
    return typeof n === "string" && n.trim() ? n : null;
  } catch { return null; }
}

/**
 * `png` with the card embedded under `key`. Any earlier card chunk (and `name`)
 * is replaced rather than appended, or readers taking the first one would show
 * the original forever. Other chunks are kept unless `preserveUnknown` is false.
 */
export function encodeCardPng(png: Uint8Array, json: string, key: string, preserveUnknown = true): Uint8Array {
  if (!isPng(png)) throw new Error("Invalid PNG data");
  const owned = new Set([...CARD_KEYS, "name"]);

  let ihdr: Chunk | null = null;
  let iend: Chunk | null = null;
  const idat: Chunk[] = [];
  const keep: Chunk[] = [];
  for (const chunk of readChunks(png)) {
    if (chunk.type === "IHDR") ihdr = chunk;
    else if (chunk.type === "IDAT") idat.push(chunk);
    else if (chunk.type === "IEND") iend = chunk;
    else if (chunk.type === "tEXt" || chunk.type === "iTXt") {
      const p = textPayload(chunk);
      if (p && !owned.has(p.keyword) && preserveUnknown) keep.push(chunk);
    } else keep.push(chunk);
  }
  if (!ihdr || idat.length === 0 || !iend) throw new Error("Invalid PNG data: missing IHDR, IDAT or IEND");

  const parts: Uint8Array[] = [SIGNATURE, chunkBytes("IHDR", ihdr.data)];
  for (const c of keep) parts.push(chunkBytes(c.type, c.data));
  parts.push(textChunk(key, bytesToBase64(new TextEncoder().encode(json))));
  const name = cardName(json);
  if (name) parts.push(textChunk("name", name));      // SillyTavern reads this one
  for (const c of idat) parts.push(chunkBytes("IDAT", c.data));
  parts.push(chunkBytes("IEND", iend.data));

  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/**
 * A 1×1 transparent PNG, the carrier for a card with no art. Verified
 * byte-for-byte (chunk lengths, CRCs, IEND) by the unit tests: an earlier
 * hand-typed constant had a wrong IDAT length and every art-less export came out
 * structurally corrupt.
 */
export const BLANK_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10,
  0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
  0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 96, 0, 2, 0, 0, 5, 0, 1, 233, 250, 220, 216,
  0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

// ─── Side chunks ──────────────────────────────────────────────────────────────
// A second tEXt chunk next to the card, for data other tools should ignore
// (FableChat's bundle: the plain portrait, reference pictures, first messages).
// Readers that only know the card keywords skip it; encodeCardPng keeps it.

/** The decoded text of the first tEXt chunk under `keyword` (base64 UTF-8, or plain), or null. */
export function readTextChunk(bytes: Uint8Array, keyword: string): string | null {
  if (!isPng(bytes)) return null;
  for (const chunk of readChunks(bytes)) {
    if (chunk.type !== "tEXt" && chunk.type !== "iTXt") continue;
    const p = textPayload(chunk);
    if (!p || p.keyword !== keyword) continue;
    const raw = new TextDecoder().decode(p.text).trim();
    try { return new TextDecoder().decode(Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))); } catch { return raw; }
  }
  return null;
}

/** `png` with `text` (base64) under `keyword`, replacing any earlier chunk of that name. Card keywords are refused. */
export function withTextChunk(png: Uint8Array, keyword: string, text: string): Uint8Array {
  if (!isPng(png)) throw new Error("Invalid PNG data");
  if (CARD_KEYS.includes(keyword) || keyword === "name") throw new Error(`"${keyword}" is a card keyword; use encodeCardPng`);
  const parts: Uint8Array[] = [SIGNATURE];
  let placed = false;
  for (const chunk of readChunks(png)) {
    if (chunk.type === "tEXt" || chunk.type === "iTXt") {
      if (textPayload(chunk)?.keyword === keyword) continue;
    }
    if (chunk.type === "IDAT" && !placed) {
      parts.push(textChunk(keyword, bytesToBase64(new TextEncoder().encode(text))));
      placed = true;
    }
    parts.push(chunkBytes(chunk.type, chunk.data));
  }
  if (!placed) throw new Error("Invalid PNG data: no image data");
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// ─── CharacterBinder / SillyTavern card import ────────────────────────────────
// Decodes cards embedded in PNGs (tEXt/iTXt chunks, base64 JSON) or plain JSON
// files, and converts them to FableChat's types. The companion app
// CharacterBinder (github.com/Fablestarexpanse/CharacterBinder) writes one
// payload per PNG under a known keyword:
//   chara | character | tavern | tavern_card_v2  → TavernCardV2 character
//   lorebook                                     → LoreBook
//   persona                                      → persona_card_v1
//   scenario                                     → scenario_card_v1
//   script                                       → script_card_v1 (unsupported)

import type { Character, LoreEntry } from "@/lib/types";

// ─── Result types ─────────────────────────────────────────────────────────────

export interface ImportedLorebook {
  name: string;
  description?: string;
  entries: Array<Omit<LoreEntry, "id" | "lorebookId">>;
}

export type ImportedCard =
  | { kind: "character"; draft: Partial<Character>; embeddedBook?: ImportedLorebook }
  | { kind: "lorebook"; book: ImportedLorebook }
  | { kind: "persona"; name: string; description: string }
  | { kind: "scenario"; name: string; book: ImportedLorebook; firstMessage?: string }
  | { kind: "unsupported"; reason: string };

// ─── PNG text-chunk reader ────────────────────────────────────────────────────

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const KNOWN_KEYS = ["chara", "character", "tavern", "tavern_card_v2", "lorebook", "script", "scenario", "persona"];

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/** Read every tEXt/iTXt keyword→text pair from a PNG. */
function readPngText(bytes: Uint8Array): Map<string, string> {
  const out = new Map<string, string>();
  const dec = new TextDecoder();
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    // Unsigned read: signed shifts turn a length byte >= 0x80 negative, which
    // walked `offset` backwards and hung the tab in an infinite loop on a
    // corrupt or crafted PNG.
    const length =
      ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
    // A declared length past the end of the file is malformed — stop parsing
    if (length > bytes.length - offset - 8) break;
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const data = bytes.slice(offset + 8, offset + 8 + length);
    offset += 12 + length; // len + type + data + crc
    if (type === "IEND") break;
    if (type !== "tEXt" && type !== "iTXt") continue;

    const nullIdx = data.indexOf(0);
    if (nullIdx === -1) continue;
    const keyword = dec.decode(data.slice(0, nullIdx));

    let text: string | null = null;
    if (type === "tEXt") {
      text = dec.decode(data.slice(nullIdx + 1));
    } else {
      // iTXt: keyword \0 compFlag compMethod lang \0 translated \0 text
      let pos = nullIdx + 1;
      const compressed = data[pos] !== 0;
      pos += 2;
      while (pos < data.length && data[pos] !== 0) pos++;
      pos++;
      while (pos < data.length && data[pos] !== 0) pos++;
      pos++;
      if (!compressed) text = dec.decode(data.slice(pos));
    }
    if (text !== null && !out.has(keyword)) out.set(keyword, text);
  }
  return out;
}

/** Base64 → UTF-8 string, or null if the input isn't base64. */
function tryBase64(text: string): string | null {
  try {
    const bin = atob(text.trim());
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Extract the embedded JSON payload (and which keyword held it) from a PNG. */
export function decodePngPayload(bytes: Uint8Array): { key: string; json: unknown } | null {
  if (!isPng(bytes)) return null;
  const texts = readPngText(bytes);
  for (const key of KNOWN_KEYS) {
    const raw = texts.get(key);
    if (!raw) continue;
    for (const candidate of [tryBase64(raw), raw]) {
      if (!candidate) continue;
      try {
        return { key, json: JSON.parse(candidate) };
      } catch {
        // try the next decoding
      }
    }
  }
  return null;
}

// ─── Converters ───────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const str = (o: Obj, k: string) => (typeof o[k] === "string" ? (o[k] as string) : undefined);

/** A v2 card nests everything under `data`; a malformed one falls back to the flat object. */
const cardData = (o: Obj): Obj =>
  o.spec === "chara_card_v2" && o.data && typeof o.data === "object" ? (o.data as Obj) : o;

/** SillyTavern v1/v2 card (or CharacterBinder character) → Character draft. */
function parseCharacterCard(json: unknown): Partial<Character> | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Obj;
  const data = cardData(obj);

  const name = str(data, "name");
  if (!name?.trim()) return null;

  const avatar = str(data, "avatar");
  return {
    name,
    description:  str(data, "description") ?? "",
    personality:  str(data, "personality"),
    scenario:     str(data, "scenario"),
    firstMessage: str(data, "first_mes") ?? str(data, "firstMessage"),
    avatar:       avatar && avatar !== "none" ? avatar : undefined,
    tags: Array.isArray(data.tags)
      ? (data.tags as unknown[]).filter((t): t is string => typeof t === "string")
      : [],
  };
}

/** One CharacterBook / LoreBook / world-info entry → FableChat LoreEntry fields. */
function convertLoreEntry(e: Obj): Omit<LoreEntry, "id" | "lorebookId"> | null {
  const keys = Array.isArray(e.keys) ? e.keys : Array.isArray(e.key) ? e.key : [];
  const content = str(e, "content") ?? str(e, "value") ?? "";
  if (!content.trim()) return null;
  const keywords = (keys as unknown[])
    .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
    .map((k) => k.trim());
  const constant = e.constant === true;
  if (keywords.length === 0 && !constant) return null;
  return {
    key: keywords.join(", ") || (str(e, "name") ?? str(e, "comment") ?? "always"),
    value: content.trim(),
    enabled: e.enabled !== false && e.disable !== true,
    priority:
      typeof e.priority === "number" ? e.priority
      : typeof e.insertion_order === "number" ? e.insertion_order
      : typeof e.order === "number" ? e.order
      : 5,
    constant,
  };
}

/**
 * LoreBook (CharacterBinder), CharacterBook (embedded in v2 cards), or
 * SillyTavern world-info ({entries: {0: {...}}}) → ImportedLorebook.
 */
export function parseLorebook(json: unknown, fallbackName = "Imported Lorebook"): ImportedLorebook | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Obj;
  const rawEntries: Obj[] = Array.isArray(obj.entries)
    ? (obj.entries as Obj[])
    : obj.entries && typeof obj.entries === "object"
      ? (Object.values(obj.entries) as Obj[])
      : [];
  if (rawEntries.length === 0) return null;

  const entries = rawEntries
    .map(convertLoreEntry)
    .filter((e): e is Omit<LoreEntry, "id" | "lorebookId"> => e !== null);
  if (entries.length === 0) return null;

  return {
    name: str(obj, "name") ?? fallbackName,
    description: str(obj, "description"),
    entries,
  };
}

/** persona_card_v1 → name + combined description. */
function parsePersonaCard(json: Obj): { name: string; description: string } | null {
  const name = str(json, "name");
  if (!name?.trim()) return null;
  const parts: string[] = [];
  const desc = str(json, "description");
  if (desc?.trim()) parts.push(desc.trim());
  for (const field of ["personality", "appearance", "background"] as const) {
    const v = str(json, field);
    if (v?.trim()) parts.push(`${field[0].toUpperCase()}${field.slice(1)}: ${v.trim()}`);
  }
  return { name, description: parts.join("\n\n") };
}

/**
 * scenario_card_v1 → an always-on lorebook. A scenario is standing story
 * context rather than a character, so it lands as constant lore entries that
 * inject into every turn of whatever chat is running.
 */
function parseScenarioCard(json: Obj): { name: string; book: ImportedLorebook; firstMessage?: string } | null {
  const name = str(json, "name");
  const scenario = str(json, "scenario");
  const description = str(json, "description");
  if (!name?.trim() || !(scenario?.trim() || description?.trim())) return null;

  const entries: Array<Omit<LoreEntry, "id" | "lorebookId">> = [];
  if (scenario?.trim()) {
    entries.push({ key: name, value: scenario.trim(), enabled: true, priority: 10, constant: true });
  }
  if (description?.trim() && description.trim() !== scenario?.trim()) {
    entries.push({ key: name, value: description.trim(), enabled: true, priority: 9, constant: true });
  }
  return {
    name,
    book: { name: `Scenario: ${name}`, description, entries },
    firstMessage: str(json, "first_mes"),
  };
}

// ─── Kind detection ───────────────────────────────────────────────────────────

/**
 * Classify a decoded payload and convert it. `key` is the PNG chunk keyword
 * when known (null for bare JSON files) — the spec field wins over the key,
 * the key wins over shape guessing.
 */
export function convertPayload(json: unknown, key: string | null): ImportedCard {
  const obj = (json && typeof json === "object" ? json : {}) as Obj;
  const spec = str(obj, "spec");

  if (spec === "script_card_v1" || key === "script") {
    return { kind: "unsupported", reason: "Script cards aren't supported in FableChat yet." };
  }

  if (spec === "persona_card_v1" || key === "persona") {
    const persona = parsePersonaCard(obj);
    return persona
      ? { kind: "persona", ...persona }
      : { kind: "unsupported", reason: "Persona card is missing a name." };
  }

  if (spec === "scenario_card_v1" || key === "scenario") {
    const scenario = parseScenarioCard(obj);
    return scenario
      ? { kind: "scenario", ...scenario }
      : { kind: "unsupported", reason: "Scenario card has no scenario text." };
  }

  if (key === "lorebook" || (!spec && obj.entries && !str(obj, "first_mes") && !str(obj, "personality") && !obj.data)) {
    const book = parseLorebook(json);
    return book
      ? { kind: "lorebook", book }
      : { kind: "unsupported", reason: "Lorebook has no usable entries (keywords + content)." };
  }

  // Character (chara_card_v2, v1 flat, or FableChat's own JSON)
  const draft = parseCharacterCard(json);
  if (draft) {
    const data = cardData(obj);
    const embeddedBook =
      data.character_book ? parseLorebook(data.character_book, `${draft.name} Lore`) ?? undefined : undefined;
    return { kind: "character", draft, embeddedBook };
  }

  return { kind: "unsupported", reason: "Couldn't recognise this card — no character, lorebook, persona or scenario found." };
}

// ─── Avatar helper ────────────────────────────────────────────────────────────

/**
 * Downscale card art to a compact data URL for use as an avatar. Full-size
 * card PNGs run to megabytes; the store (and its SQLite mirror) shouldn't
 * carry that per character.
 */
export function downscaleImage(file: Blob, maxDim = 512): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.fillStyle = "#ffffff"; // JPEG has no alpha — flatten on white
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.87));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

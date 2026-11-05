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
import { decodeCardPng, isPng } from "@/lib/cards/png";
import { cardData, cardToCharacterDraft, splitImageLook } from "@/lib/cards/tavern";
import type { ImageLook } from "@/lib/media/imageLook";
import { detectPlatform } from "@/lib/cards/platforms";
import { convertCardFrom } from "@/lib/cards/convert";

// ─── Result types ─────────────────────────────────────────────────────────────

export interface ImportedLorebook {
  name: string;
  description?: string;
  entries: Array<Omit<LoreEntry, "id" | "lorebookId">>;
}

export type ImportedCard =
  | { kind: "character"; draft: Partial<Character>; embeddedBook?: ImportedLorebook }
  | { kind: "lorebook"; book: ImportedLorebook }
  | { kind: "persona"; name: string; description: string; image?: ImageLook }
  | { kind: "scenario"; name: string; book: ImportedLorebook; firstMessage?: string }
  | { kind: "unsupported"; reason: string };

// ─── PNG ──────────────────────────────────────────────────────────────────────
// One codec for read and write: lib/cards/png.ts. This file used to carry its own
// read-only copy.

export { isPng };

/** Extract the embedded JSON payload (and which keyword held it) from a PNG. */
export function decodePngPayload(bytes: Uint8Array): { key: string; json: unknown } | null {
  const decoded = decodeCardPng(bytes);
  if (decoded.json === null || decoded.key === null) return null;
  return { key: decoded.key, json: JSON.parse(decoded.json) };
}

// ─── Converters ───────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const str = (o: Obj, k: string) => (typeof o[k] === "string" ? (o[k] as string) : undefined);

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
  // SillyTavern world-info spells these differently from card books
  const secondary = (Array.isArray(e.secondary_keys) ? e.secondary_keys : Array.isArray(e.keysecondary) ? e.keysecondary : [])
    .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
    .map((k) => k.trim());
  const memo = str(e, "comment") ?? str(e, "name");
  return {
    key: keywords.join(", ") || (str(e, "name") ?? str(e, "comment") ?? "always"),
    ...(secondary.length > 0 ? { secondaryKeys: secondary } : {}),
    ...(e.selective === true ? { selective: true } : {}),
    ...((e.case_sensitive ?? e.caseSensitive) === true ? { caseSensitive: true } : {}),
    // ST stores position as a number (0 before the character, 1 after); cards use names
    ...(e.position === "after_char" || e.position === 1 ? { position: "after_char" as const }
      : e.position === "before_char" || e.position === 0 ? { position: "before_char" as const } : {}),
    ...(memo?.trim() ? { comment: memo.trim() } : {}),
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
export function parseLorebook(
  json: unknown, fallbackName = "Imported Lorebook", { allowEmpty = false }: { allowEmpty?: boolean } = {},
): ImportedLorebook | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Obj;
  const rawEntries: Obj[] = Array.isArray(obj.entries)
    ? (obj.entries as Obj[])
    : obj.entries && typeof obj.entries === "object"
      ? (Object.values(obj.entries) as Obj[])
      : [];
  // A named book file with no entries yet is still a book (this app exports empty
  // ones); an empty book embedded in a character is just absent.
  if (rawEntries.length === 0) {
    const name = str(obj, "name");
    return allowEmpty && name?.trim() ? { name, description: str(obj, "description"), entries: [] } : null;
  }

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
function parsePersonaCard(json: Obj): { name: string; description: string; image?: ImageLook } | null {
  const name = str(json, "name");
  if (!name?.trim()) return null;
  const parts: string[] = [];
  const desc = str(json, "description");
  if (desc?.trim()) parts.push(desc.trim());
  for (const field of ["personality", "appearance", "background"] as const) {
    const v = str(json, field);
    if (v?.trim()) parts.push(`${field[0].toUpperCase()}${field.slice(1)}: ${v.trim()}`);
  }
  const ext = json.extensions && typeof json.extensions === "object" && !Array.isArray(json.extensions) ? json.extensions as Obj : undefined;
  const image = splitImageLook(ext).look;
  return { name, description: parts.join("\n\n"), ...(image ? { image } : {}) };
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
    const book = parseLorebook(json, undefined, { allowEmpty: true });
    return book
      ? { kind: "lorebook", book }
      : { kind: "unsupported", reason: "Lorebook has no usable entries (keywords + content)." };
  }

  // Character. JanitorAI, Agnai and Backyard each write their own field names
  // (persona/greeting, sampleChat, aiName/basePrompt); convert those to a V2 card
  // first. Everything else is already V2 or flat and reads directly.
  const platform = detectPlatform(json);
  const normalised =
    platform === "janitorai" || platform === "agnai" || platform === "backyard"
      ? convertCardFrom(obj, platform)
      : json;
  const draft = cardToCharacterDraft(normalised);
  if (draft) {
    const data = cardData((normalised && typeof normalised === "object" ? normalised : obj) as Obj);
    const embeddedBook =
      data.character_book ? parseLorebook(data.character_book, `${draft.name} Lore`) ?? undefined : undefined;
    return { kind: "character", draft, embeddedBook };
  }

  return { kind: "unsupported", reason: "Couldn't recognise this card — no character, lorebook, persona or scenario found." };
}

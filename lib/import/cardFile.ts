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
import { cardData, cardToCharacterDraft } from "@/lib/cards/tavern";

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
  const draft = cardToCharacterDraft(json);
  if (draft) {
    const data = cardData(obj);
    const embeddedBook =
      data.character_book ? parseLorebook(data.character_book, `${draft.name} Lore`) ?? undefined : undefined;
    return { kind: "character", draft, embeddedBook };
  }

  return { kind: "unsupported", reason: "Couldn't recognise this card — no character, lorebook, persona or scenario found." };
}

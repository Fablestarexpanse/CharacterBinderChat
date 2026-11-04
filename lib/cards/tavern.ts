// ─── Tavern Card V2 ───────────────────────────────────────────────────────────
// The interchange format character cards travel in, and the two mappings between
// it and FableChat's Character. Pure: no DOM, no store. The import side lives in
// lib/import/cardFile.ts (which also handles lorebooks, personas, scenarios);
// this module owns the shape and the character mappings both directions use.
//
// Parts derive from CharacterBinder (MIT): the V2 types, createBlankCard,
// coerceCardData, and the lorebook/persona/scenario card shapes. The mappings to
// and from Character are original. License notice: THIRD_PARTY_NOTICES.md.

import type { Character, LoreEntry } from "@/lib/types";

export interface CharacterBookEntry {
  keys: string[];
  content: string;
  extensions: Record<string, unknown>;
  enabled: boolean;
  insertion_order: number;
  case_sensitive?: boolean;
  name?: string;
  priority?: number;
  id?: number;
  comment?: string;
  selective?: boolean;
  secondary_keys?: string[];
  constant?: boolean;
  position?: "before_char" | "after_char";
}

export interface CharacterBook {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions: Record<string, unknown>;
  entries: CharacterBookEntry[];
}

export interface TavernCardV2Data {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  character_book?: CharacterBook;
  tags: string[];
  creator: string;
  character_version: string;
  extensions: Record<string, unknown>;
}

/** A type alias, not an interface, so it satisfies Record<string, unknown>. */
export type TavernCardV2 = {
  spec: "chara_card_v2";
  spec_version: "2.0";
  data: TavernCardV2Data;
};

type Obj = Record<string, unknown>;
const str = (o: Obj, k: string): string | undefined => (typeof o[k] === "string" ? (o[k] as string) : undefined);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

// ─── Character → card ─────────────────────────────────────────────────────────

/**
 * A Character as a spec-valid V2 card. Optional fields become empty strings (the
 * spec has no "absent"), and `cardExtensions` goes back out unchanged so data a
 * platform put there survives a trip through FableChat.
 */
export function characterToCard(character: Character, book?: CharacterBook): TavernCardV2 {
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name:                      character.name,
      description:               character.description ?? "",
      personality:               character.personality ?? "",
      scenario:                  character.scenario ?? "",
      first_mes:                 character.firstMessage ?? "",
      mes_example:               character.exampleDialogue ?? "",
      creator_notes:             character.creatorNotes ?? "",
      system_prompt:             character.systemPrompt ?? "",
      post_history_instructions: character.postHistoryInstructions ?? "",
      alternate_greetings:       character.alternateGreetings ?? [],
      ...(book ? { character_book: book } : {}),
      tags:                      character.tags ?? [],
      creator:                   character.creator ?? "",
      character_version:         character.characterVersion ?? "1.0",
      extensions:                character.cardExtensions ?? {},
    },
  };
}

/** A FableChat lorebook as an embeddable CharacterBook. */
export function loreToCharacterBook(
  name: string, description: string | undefined, entries: LoreEntry[],
): CharacterBook {
  return {
    name,
    ...(description ? { description } : {}),
    extensions: {},
    entries: entries.map((e, i) => {
      const keys = e.key.split(",").map((k) => k.trim()).filter(Boolean);
      return {
        keys,
        content:         e.value,
        extensions:      {},
        enabled:         e.enabled,
        insertion_order: e.priority ?? i,
        constant:        e.constant ?? false,
        name:            e.comment || keys[0] || "",
        comment:         e.comment ?? "",
        selective:       e.selective ?? false,
        secondary_keys:  e.secondaryKeys ?? [],
        case_sensitive:  e.caseSensitive ?? false,
        position:        e.position ?? "before_char",
      };
    }),
  };
}

// ─── Card → character draft ───────────────────────────────────────────────────

/** A v2 card nests its fields under `data`; v1 and FableChat's own JSON are flat. */
export const cardData = (o: Obj): Obj =>
  o.spec === "chara_card_v2" && o.data && typeof o.data === "object" ? (o.data as Obj) : o;

/** Character fields from a card's data block, or null when it has no name. */
export function cardToCharacterDraft(json: unknown): Partial<Character> | null {
  if (!json || typeof json !== "object") return null;
  const data = cardData(json as Obj);
  const name = str(data, "name");
  if (!name?.trim()) return null;

  const avatar = str(data, "avatar");
  const extensions = data.extensions && typeof data.extensions === "object" && !Array.isArray(data.extensions)
    ? (data.extensions as Record<string, unknown>) : undefined;
  const nonEmpty = (v: string | undefined) => (v && v.trim() ? v : undefined);
  const greetings = strList(data.alternate_greetings).filter((g) => g.trim());

  return {
    name,
    description:  str(data, "description") ?? "",
    personality:  str(data, "personality"),
    scenario:     str(data, "scenario"),
    firstMessage: str(data, "first_mes") ?? str(data, "firstMessage"),
    avatar:       avatar && avatar !== "none" ? avatar : undefined,
    tags:         strList(data.tags),
    exampleDialogue:         nonEmpty(str(data, "mes_example")),
    systemPrompt:            nonEmpty(str(data, "system_prompt")),
    postHistoryInstructions: nonEmpty(str(data, "post_history_instructions")),
    alternateGreetings:      greetings.length > 0 ? greetings : undefined,
    creator:                 nonEmpty(str(data, "creator")),
    creatorNotes:            nonEmpty(str(data, "creator_notes")),
    characterVersion:        nonEmpty(str(data, "character_version")),
    cardExtensions:          extensions && Object.keys(extensions).length > 0 ? extensions : undefined,
  };
}

// ─── Macros ───────────────────────────────────────────────────────────────────

/**
 * Cards are written with placeholders — {{char}}, {{user}}, and the older
 * <BOT>/<USER> — that the chat client fills in. Sent to a model unexpanded, a
 * card reads "{{user}} walks in" and the model has no idea who that is.
 */
export function expandMacros(text: string, names: { char: string; user: string }): string {
  return text
    .replace(/\{\{\s*(?:char|bot)\s*\}\}|<BOT>/gi, () => names.char)
    .replace(/\{\{\s*user\s*\}\}|<USER>/gi, () => names.user);
}

/** `<START>` separates example conversations in mes_example. */
export function formatExampleDialogue(text: string): string {
  return text.replace(/<START>/gi, "---").trim();
}

// ─── The other card kinds ─────────────────────────────────────────────────────
// CharacterBinder's lorebook, persona and scenario payloads. Not Tavern V2, but
// the same PNG container under their own keyword, and the same importer reads them.

/** A lorebook in CharacterBinder's interchange shape (entries identified by position). */
export function lorebookToCard(book: { name: string; description?: string; entries: LoreEntry[] }) {
  return {
    name: book.name,
    description: book.description ?? "",
    creator: "",
    version: "1.0",
    creator_notes: "",
    scan_depth: 50,
    token_budget: 512,
    recursive_scanning: false,
    extensions: {},
    entries: book.entries.map((e, i) => {
      const keys = e.key.split(",").map((k) => k.trim()).filter(Boolean);
      return {
        id: i,
        keys,
        secondary_keys: e.secondaryKeys ?? [],
        comment: e.comment ?? "",
        content: e.value,
        constant: e.constant ?? false,
        selective: e.selective ?? false,
        insertion_order: e.priority ?? 100,
        enabled: e.enabled,
        position: e.position ?? "before_char",
        case_sensitive: e.caseSensitive ?? false,
        name: e.comment || keys[0] || "",
        priority: e.priority ?? 10,
        extensions: {},
      };
    }),
  };
}

/** FableChat keeps one description for a persona; the card's other fields stay empty. */
export function personaToCard(p: { name: string; description: string }) {
  return {
    spec: "persona_card_v1" as const,
    name: p.name,
    description: p.description,
    personality: "",
    appearance: "",
    background: "",
    tags: [] as string[],
    creator: "",
    version: "1.0",
    creator_notes: "",
  };
}

export function scenarioToCard(s: { name: string; scenario: string; firstMessage?: string }) {
  return {
    spec: "scenario_card_v1" as const,
    name: s.name,
    description: "",
    scenario: s.scenario,
    first_mes: s.firstMessage ?? "",
    tags: [] as string[],
    creator: "",
    version: "1.0",
    creator_notes: "",
  };
}

// ─── Blank and coerced cards ──────────────────────────────────────────────────

/** An empty, spec-valid card: the starting shape for every conversion path. */
export function createBlankCard(name = ""): TavernCardV2 {
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name, description: "", personality: "", scenario: "", first_mes: "", mes_example: "",
      creator_notes: "", system_prompt: "", post_history_instructions: "",
      alternate_greetings: [], tags: [], creator: "", character_version: "1.0", extensions: {},
    },
  };
}

/**
 * A card's `data` block from an arbitrary object, keeping only V2 fields and only
 * where the value has the right type. A third-party card that declares v2 with a
 * partial or wrongly-typed block otherwise reaches a converter with undefined
 * fields, and the first `.replace()` on one throws at export time.
 */
export function coerceCardData(body: Record<string, unknown>): TavernCardV2["data"] {
  const blank = createBlankCard().data as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...blank };
  for (const [key, fallback] of Object.entries(blank)) {
    if (!(key in body)) continue;
    const v = body[key];
    if (key === "extensions") {
      if (v && typeof v === "object" && !Array.isArray(v)) out[key] = v;
    } else if (Array.isArray(fallback)) {
      out[key] = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : fallback;
    } else {
      out[key] = typeof v === "string" ? v : fallback;
    }
  }
  if (body.character_book && typeof body.character_book === "object" && !Array.isArray(body.character_book)) {
    out.character_book = body.character_book;
  }
  return out as unknown as TavernCardV2["data"];
}

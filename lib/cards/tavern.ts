// ─── Tavern Card V2 ───────────────────────────────────────────────────────────
// The interchange format character cards travel in, and the two mappings between
// it and FableChat's Character. Pure: no DOM, no store. The import side lives in
// lib/import/cardFile.ts (which also handles lorebooks, personas, scenarios);
// this module owns the shape and the character mappings both directions use.

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
        name:            keys[0] ?? "",
        comment:         "",
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
    .replace(/\{\{\s*char\s*\}\}|<BOT>/gi, () => names.char)
    .replace(/\{\{\s*user\s*\}\}|<USER>/gi, () => names.user);
}

/** `<START>` separates example conversations in mes_example. */
export function formatExampleDialogue(text: string): string {
  return text.replace(/<START>/gi, "---").trim();
}

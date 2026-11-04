// ─── Platform registry ────────────────────────────────────────────────────────
// What each card site accepts, which fields it drops or renames, and how to
// recognise its JSON. Ported from CharacterBinder (MIT) without its UI styling.
// The field table is what powers "this platform will drop X" warnings on export.

import type { TavernCardV2 } from "./tavern";

/** The PNG chunk keyword a card for a platform is written under. */
type MetadataKey = string;

/**
 * Every platform the app converts for, in the order the picker shows them.
 * Declared as a tuple so the type is derived from it — and so schemas that need
 * the list (the MCP tools) can take it rather than restating the members.
 */
export const PLATFORM_IDS = [
  "sillytavern",
  "janitorai",
  "chub",
  "agnai",
  "venus",
  "backyard",
  "risu",
  "generic",
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];

export interface FieldSupport {
  field: keyof TavernCardV2["data"];
  label: string;
  support: "full" | "partial" | "none" | "renamed";
  note?: string;
}

export interface PlatformDef {
  id: PlatformId;
  name: string;
  description: string;
  pngSupport: boolean;
  jsonSupport: boolean;
  /**
   * The PNG chunk key a card for this platform is written under.
   *
   * Required even where `pngSupport` is false: the app will still build a PNG
   * for archiving, and it has to put the card somewhere. That used to be an
   * absent field and a fallback invented at each of four call sites.
   */
  metadataKey: MetadataKey;
  templateVars: { user: string; char: string };
  fields: FieldSupport[];
  importKeys: string[];    // JSON keys that identify this format
  website?: string;
}

export const PLATFORMS: Record<PlatformId, PlatformDef> = {
  sillytavern: {
    id: "sillytavern",
    name: "SillyTavern",
    description: "Full Tavern Card v2 — all fields supported",
    pngSupport: true,
    jsonSupport: true,
    metadataKey: "chara",
    templateVars: { user: "{{user}}", char: "{{char}}" },
    importKeys: ["spec", "spec_version"],
    fields: [
      { field: "name", label: "Name", support: "full" },
      { field: "description", label: "Description", support: "full" },
      { field: "personality", label: "Personality", support: "full" },
      { field: "scenario", label: "Scenario", support: "full" },
      { field: "first_mes", label: "First Message", support: "full" },
      { field: "mes_example", label: "Example Dialogs", support: "full" },
      { field: "system_prompt", label: "System Prompt", support: "full" },
      { field: "post_history_instructions", label: "Post-History", support: "full" },
      { field: "alternate_greetings", label: "Alternate Greetings", support: "full" },
      { field: "character_book", label: "Lorebook", support: "full" },
      { field: "tags", label: "Tags", support: "full" },
      { field: "creator", label: "Creator", support: "full" },
      { field: "creator_notes", label: "Creator Notes", support: "full" },
      { field: "character_version", label: "Version", support: "full" },
    ],
  },

  janitorai: {
    id: "janitorai",
    name: "JanitorAI",
    description: "JSON import only — description maps to 'persona'",
    pngSupport: false,
    // No PNG import of its own, but an archive PNG still has to carry the card.
    metadataKey: "chara",
    jsonSupport: true,
    templateVars: { user: "{{user}}", char: "{{bot}}" },
    importKeys: ["persona", "greeting"],
    fields: [
      { field: "name", label: "Name", support: "full" },
      { field: "description", label: "Description → persona", support: "renamed", note: "Exported as 'persona'" },
      { field: "personality", label: "Personality", support: "partial", note: "Merged into 'persona'" },
      { field: "scenario", label: "Scenario → world", support: "renamed", note: "Exported as 'world'" },
      { field: "first_mes", label: "First Message → greeting", support: "renamed" },
      { field: "mes_example", label: "Example Dialogs", support: "partial", note: "{{char}} becomes {{bot}}" },
      { field: "system_prompt", label: "System Prompt", support: "none", note: "Not supported" },
      { field: "post_history_instructions", label: "Post-History", support: "none" },
      { field: "alternate_greetings", label: "Alternate Greetings", support: "none" },
      { field: "character_book", label: "Lorebook", support: "none" },
      { field: "tags", label: "Tags", support: "full" },
      { field: "creator", label: "Creator", support: "none" },
      { field: "creator_notes", label: "Creator Notes", support: "none" },
      { field: "character_version", label: "Version", support: "none" },
    ],
  },

  chub: {
    id: "chub",
    name: "Chub.ai",
    description: "Tavern v2 compatible + Chub extensions block",
    pngSupport: true,
    jsonSupport: true,
    metadataKey: "chara",
    templateVars: { user: "{{user}}", char: "{{char}}" },
    importKeys: ["spec", "extensions"],
    fields: [
      { field: "name", label: "Name", support: "full" },
      { field: "description", label: "Description", support: "full" },
      { field: "personality", label: "Personality", support: "full" },
      { field: "scenario", label: "Scenario", support: "full" },
      { field: "first_mes", label: "First Message", support: "full" },
      { field: "mes_example", label: "Example Dialogs", support: "full" },
      { field: "system_prompt", label: "System Prompt", support: "full" },
      { field: "post_history_instructions", label: "Post-History", support: "full" },
      { field: "alternate_greetings", label: "Alternate Greetings", support: "full" },
      { field: "character_book", label: "Lorebook", support: "full" },
      { field: "tags", label: "Tags", support: "full" },
      { field: "creator", label: "Creator", support: "full" },
      { field: "creator_notes", label: "Creator Notes", support: "full" },
      { field: "character_version", label: "Version", support: "full" },
    ],
  },

  agnai: {
    id: "agnai",
    name: "Agnai",
    description: "JSON only — different schema with persona.attributes",
    pngSupport: false,
    // No PNG import of its own, but an archive PNG still has to carry the card.
    metadataKey: "chara",
    jsonSupport: true,
    templateVars: { user: "{{user}}", char: "{{char}}" },
    importKeys: ["kind", "persona", "sampleChat"],
    fields: [
      { field: "name", label: "Name", support: "full" },
      { field: "description", label: "Description", support: "full" },
      { field: "personality", label: "Personality → persona.attributes", support: "renamed", note: "Nested in persona.attributes.personality" },
      { field: "scenario", label: "Scenario", support: "full" },
      { field: "first_mes", label: "First Message → greeting", support: "renamed" },
      { field: "mes_example", label: "Example Dialogs → sampleChat", support: "renamed" },
      { field: "system_prompt", label: "System Prompt → systemPrompt", support: "renamed" },
      { field: "post_history_instructions", label: "Post-History → postHistoryInstructions", support: "renamed" },
      { field: "alternate_greetings", label: "Alternate Greetings", support: "none" },
      { field: "character_book", label: "Lorebook", support: "none", note: "Agnai uses separate 'memory book'" },
      { field: "tags", label: "Tags", support: "full" },
      { field: "creator", label: "Creator", support: "partial" },
      { field: "creator_notes", label: "Creator Notes", support: "none" },
      { field: "character_version", label: "Version → characterVersion", support: "renamed" },
    ],
  },

  venus: {
    id: "venus",
    name: "Venus AI",
    description: "Tavern v1/v2 hybrid — v2 fields may be ignored",
    pngSupport: true,
    jsonSupport: true,
    metadataKey: "chara",
    templateVars: { user: "{{user}}", char: "{{char}}" },
    importKeys: ["name", "description", "first_mes"],
    fields: [
      { field: "name", label: "Name", support: "full" },
      { field: "description", label: "Description", support: "full" },
      { field: "personality", label: "Personality", support: "full" },
      { field: "scenario", label: "Scenario", support: "full" },
      { field: "first_mes", label: "First Message", support: "full" },
      { field: "mes_example", label: "Example Dialogs", support: "full" },
      { field: "system_prompt", label: "System Prompt", support: "partial", note: "May be ignored on older versions" },
      { field: "post_history_instructions", label: "Post-History", support: "partial" },
      { field: "alternate_greetings", label: "Alternate Greetings", support: "partial" },
      { field: "character_book", label: "Lorebook", support: "partial" },
      { field: "tags", label: "Tags", support: "full" },
      // Written into the file and carried with the card, but not shown in the
      // Venus UI. "none" said the export drops them, which it does not — and
      // the difference matters when the file is later opened somewhere else.
      { field: "creator", label: "Creator", support: "partial", note: "Stored in the card, not shown in Venus" },
      { field: "creator_notes", label: "Creator Notes", support: "partial", note: "Stored in the card, not shown in Venus" },
      { field: "character_version", label: "Version", support: "partial", note: "Stored in the card, not shown in Venus" },
    ],
  },

  backyard: {
    id: "backyard",
    name: "Backyard AI",
    description: "Own schema — name/description/prompt remapped",
    pngSupport: false,
    // No PNG import of its own, but an archive PNG still has to carry the card.
    metadataKey: "chara",
    jsonSupport: true,
    templateVars: { user: "{{user}}", char: "{{char}}" },
    importKeys: ["aiName", "basePrompt", "initialMessage"],
    fields: [
      { field: "name", label: "Name → aiName", support: "renamed" },
      { field: "description", label: "Description → basePrompt", support: "renamed", note: "Combined with personality" },
      { field: "personality", label: "Personality → basePrompt", support: "partial", note: "Merged into basePrompt" },
      { field: "scenario", label: "Scenario", support: "partial" },
      { field: "first_mes", label: "First Message → initialMessage", support: "renamed" },
      { field: "mes_example", label: "Example Dialogs", support: "none" },
      { field: "system_prompt", label: "System Prompt", support: "partial" },
      { field: "post_history_instructions", label: "Post-History", support: "none" },
      { field: "alternate_greetings", label: "Alternate Greetings", support: "none" },
      { field: "character_book", label: "Lorebook", support: "none" },
      { field: "tags", label: "Tags", support: "none" },
      { field: "creator", label: "Creator", support: "none" },
      { field: "creator_notes", label: "Creator Notes", support: "none" },
      { field: "character_version", label: "Version", support: "none" },
    ],
  },

  risu: {
    id: "risu",
    name: "RisuAI",
    description: "Tavern v2 + RisuAI extensions (regex, UI modules)",
    pngSupport: true,
    jsonSupport: true,
    metadataKey: "chara",
    templateVars: { user: "{{user}}", char: "{{char}}" },
    importKeys: ["spec", "extensions"],
    fields: [
      { field: "name", label: "Name", support: "full" },
      { field: "description", label: "Description", support: "full" },
      { field: "personality", label: "Personality", support: "full" },
      { field: "scenario", label: "Scenario", support: "full" },
      { field: "first_mes", label: "First Message", support: "full" },
      { field: "mes_example", label: "Example Dialogs", support: "full" },
      { field: "system_prompt", label: "System Prompt", support: "full" },
      { field: "post_history_instructions", label: "Post-History", support: "full" },
      { field: "alternate_greetings", label: "Alternate Greetings", support: "full" },
      { field: "character_book", label: "Lorebook", support: "full" },
      { field: "tags", label: "Tags", support: "full" },
      { field: "creator", label: "Creator", support: "full" },
      { field: "creator_notes", label: "Creator Notes", support: "full" },
      { field: "character_version", label: "Version", support: "full" },
    ],
  },

  generic: {
    id: "generic",
    name: "Generic / Other",
    description: "Plain JSON fallback — basic fields only",
    pngSupport: true,
    jsonSupport: true,
    metadataKey: "character",
    templateVars: { user: "{{user}}", char: "{{char}}" },
    importKeys: ["name", "description"],
    fields: [
      { field: "name", label: "Name", support: "full" },
      { field: "description", label: "Description", support: "full" },
      { field: "personality", label: "Personality", support: "partial" },
      { field: "scenario", label: "Scenario", support: "partial" },
      { field: "first_mes", label: "First Message", support: "partial" },
      { field: "mes_example", label: "Example Dialogs", support: "partial" },
      // Written into the JSON; whether the receiving tool reads it is its own
      // business, but the export does not drop it.
      { field: "system_prompt", label: "System Prompt", support: "partial", note: "Written; support depends on the tool" },
      { field: "post_history_instructions", label: "Post-History", support: "none" },
      { field: "alternate_greetings", label: "Alternate Greetings", support: "none" },
      { field: "character_book", label: "Lorebook", support: "none" },
      { field: "tags", label: "Tags", support: "partial" },
      { field: "creator", label: "Creator", support: "partial" },
      { field: "creator_notes", label: "Creator Notes", support: "none" },
      { field: "character_version", label: "Version", support: "none" },
    ],
  },
};

export const PLATFORM_LIST = Object.values(PLATFORMS);

export function detectPlatform(json: unknown): PlatformId {
  if (!json || typeof json !== "object") return "generic";
  const obj = json as Record<string, unknown>;

  if (obj.spec === "chara_card_v2" || obj.spec === "chara_card_v1") {
    // Distinguish RisuAI vs SillyTavern vs Chub by extensions
    if (obj.data && typeof obj.data === "object") {
      const data = obj.data as Record<string, unknown>;
      const ext = data.extensions as Record<string, unknown> | undefined;
      if (ext?.risuai || ext?.risu) return "risu";
      if (ext?.chub) return "chub";
    }
    return "sillytavern";
  }
  if (obj.kind === "character" && obj.persona && obj.sampleChat !== undefined) return "agnai";
  if (obj.persona !== undefined && obj.greeting !== undefined) return "janitorai";
  if (obj.aiName !== undefined || obj.basePrompt !== undefined || obj.initialMessage !== undefined) return "backyard";
  if (obj.name && obj.description && obj.first_mes !== undefined) return "venus";
  return "generic";
}


// ─── Platform converters ──────────────────────────────────────────────────────
// Master (Tavern V2) card <-> each platform's own JSON. Ported from CharacterBinder
// License notice: see THIRD_PARTY_NOTICES.md (MIT).
// (MIT). Export is lossy by design for platforms with fewer fields; the registry's
// field table says which, so the UI can warn before the file is written.

import type { TavernCardV2 } from "./tavern";
import { createBlankCard, coerceCardData } from "./tavern";
import { PLATFORMS, type PlatformId } from "./platforms";

// ─── Master → Platform ───────────────────────────────────────────────────────
//
// Every convertTo* returns Record<string, unknown> — the JSON body written to a
// file for that platform. Three of them happen to produce a Tavern v2 card, but
// declaring that as their return type split the family in two and forced the
// dispatcher to cast through `unknown` on exactly those three.

function convertToSillyTavern(card: TavernCardV2): Record<string, unknown> {
  return structuredClone(card);
}

function convertToJanitorAI(card: TavernCardV2): Record<string, unknown> {
  const { data } = card;
  // JanitorAI uses {{bot}} instead of {{char}}
  const replaceVars = (s: string) => s.replace(/\{\{char\}\}/g, "{{bot}}");
  const persona = [data.description, data.personality].filter(Boolean).join("\n\n");
  return {
    name: data.name,
    persona: replaceVars(persona),
    world: replaceVars(data.scenario),
    scenario: replaceVars(data.scenario),
    greeting: replaceVars(data.first_mes),
    example_dialogs: replaceVars(data.mes_example),
    visibility: "public",
    tags: data.tags,
    nsfw: false,
  };
}

function convertToChub(card: TavernCardV2): Record<string, unknown> {
  const clone = structuredClone(card);
  clone.data.extensions = {
    ...clone.data.extensions,
    chub: {
      full_path: "",
      rating: "SFW",
      tagline: clone.data.description.slice(0, 120),
    },
  };
  return clone;
}

function convertToAgnai(card: TavernCardV2): Record<string, unknown> {
  const { data } = card;
  return {
    kind: "character",
    name: data.name,
    description: data.description,
    persona: {
      kind: "text",
      attributes: {
        personality: [data.personality],
      },
    },
    sampleChat: data.mes_example,
    scenario: data.scenario,
    greeting: data.first_mes,
    systemPrompt: data.system_prompt,
    postHistoryInstructions: data.post_history_instructions,
    tags: data.tags,
    creator: data.creator,
    characterVersion: data.character_version,
  };
}

function convertToVenus(card: TavernCardV2): Record<string, unknown> {
  const { data } = card;
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: data.name,
      description: data.description,
      personality: data.personality,
      scenario: data.scenario,
      first_mes: data.first_mes,
      mes_example: data.mes_example,
      tags: data.tags,
      alternate_greetings: data.alternate_greetings,
      // The compatibility table lists these as "partial" — they may be ignored
      // by older Venus builds, but writing them is what "partial" means. They
      // were previously omitted entirely, so the UI was promising more than the
      // export delivered.
      system_prompt: data.system_prompt,
      post_history_instructions: data.post_history_instructions,
      character_book: data.character_book,
      creator: data.creator,
      creator_notes: data.creator_notes,
      character_version: data.character_version,
    },
  };
}

function convertToBackyard(card: TavernCardV2): Record<string, unknown> {
  const { data } = card;
  const basePrompt = [data.description, data.personality].filter(Boolean).join("\n\n");
  return {
    aiName: data.name,
    basePrompt,
    scenario: data.scenario,
    initialMessage: data.first_mes,
    systemPrompt: data.system_prompt || undefined,
    type: "character",
  };
}

function convertToRisu(card: TavernCardV2): Record<string, unknown> {
  const clone = structuredClone(card);
  clone.data.extensions = {
    ...clone.data.extensions,
    risuai: {
      assets: [],
    },
  };
  return clone;
}

function convertToGeneric(card: TavernCardV2): Record<string, unknown> {
  const { data } = card;
  return {
    name: data.name,
    description: data.description,
    personality: data.personality,
    scenario: data.scenario,
    first_message: data.first_mes,
    example_dialogs: data.mes_example,
    system_prompt: data.system_prompt || undefined,
    tags: data.tags,
    creator: data.creator || undefined,
    version: data.character_version,
  };
}

// ─── Platform → Master ───────────────────────────────────────────────────────

function convertFromJanitorAI(obj: Record<string, unknown>): TavernCardV2 {
  const card = createBlankCard(String(obj.name ?? ""));
  const replaceVars = (s: string) => s.replace(/\{\{bot\}\}/g, "{{char}}");
  card.data.description = replaceVars(String(obj.persona ?? ""));
  card.data.scenario = replaceVars(String(obj.world ?? obj.scenario ?? ""));
  card.data.first_mes = replaceVars(String(obj.greeting ?? ""));
  card.data.mes_example = replaceVars(String(obj.example_dialogs ?? ""));
  card.data.tags = Array.isArray(obj.tags) ? obj.tags.map(String) : [];
  return card;
}

function convertFromAgnai(obj: Record<string, unknown>): TavernCardV2 {
  const card = createBlankCard(String(obj.name ?? ""));
  card.data.description = String(obj.description ?? "");
  const persona = obj.persona as Record<string, unknown> | undefined;
  const attrs = persona?.attributes as Record<string, unknown> | undefined;
  const personalityArr = attrs?.personality;
  card.data.personality = Array.isArray(personalityArr) ? String(personalityArr[0] ?? "") : "";
  card.data.scenario = String(obj.scenario ?? "");
  card.data.first_mes = String(obj.greeting ?? "");
  card.data.mes_example = String(obj.sampleChat ?? "");
  card.data.system_prompt = String(obj.systemPrompt ?? "");
  card.data.post_history_instructions = String(obj.postHistoryInstructions ?? "");
  card.data.tags = Array.isArray(obj.tags) ? obj.tags.map(String) : [];
  card.data.creator = String(obj.creator ?? "");
  card.data.character_version = String(obj.characterVersion ?? "1.0");
  return card;
}

function convertFromBackyard(obj: Record<string, unknown>): TavernCardV2 {
  const card = createBlankCard(String(obj.aiName ?? obj.name ?? ""));
  card.data.description = String(obj.basePrompt ?? obj.description ?? "");
  card.data.scenario = String(obj.scenario ?? "");
  card.data.first_mes = String(obj.initialMessage ?? obj.first_mes ?? "");
  card.data.system_prompt = String(obj.systemPrompt ?? "");
  return card;
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export function convertCardTo(
  card: TavernCardV2,
  platformId: PlatformId
): Record<string, unknown> {
  switch (platformId) {
    case "sillytavern": return convertToSillyTavern(card);
    case "janitorai":   return convertToJanitorAI(card);
    case "chub":        return convertToChub(card);
    case "agnai":       return convertToAgnai(card);
    case "venus":       return convertToVenus(card);
    case "backyard":    return convertToBackyard(card);
    case "risu":        return convertToRisu(card);
    case "generic":     return convertToGeneric(card);
  }
}

export function convertCardFrom(
  obj: Record<string, unknown>,
  platformId: PlatformId
): TavernCardV2 {
  switch (platformId) {
    // Only the three platforms with their own field names need a reader; the
    // rest — SillyTavern, Chub, Venus, RisuAI and Generic — write Tavern v2 and
    // share the default branch.
    case "janitorai":  return convertFromJanitorAI(obj);
    case "agnai":      return convertFromAgnai(obj);
    case "backyard":   return convertFromBackyard(obj);
    default: {
      // SillyTavern, Chub, Venus, RisuAI, Generic — all basically Tavern v2 shape.
      // v3 is read here too: its `data` block is a superset of v2's, so the
      // spread below keeps every field this app knows and drops the v3-only
      // ones. cardShape has always detected v3, and without this gate those
      // cards fell through to the loose field mapping below and imported blank,
      // since a v3 card carries nothing at its top level but `spec` and `data`.
      if (obj.spec === "chara_card_v2" || obj.spec === "chara_card_v3") {
        // Coerced, not spread. A third-party card that declares v2 with a
        // partial or wrongly-typed `data` block used to come back with
        // undefined or non-string fields, and the first converter to call
        // .replace() or .slice() on one threw at export time. This is the same
        // coercion the bridge applies to a card an agent sends, so a card is
        // read one way whichever door it arrives through.
        const incoming = obj.data && typeof obj.data === "object" ? (obj.data as Record<string, unknown>) : {};
        const card = createBlankCard();
        card.data = coerceCardData(incoming);
        return card;
      }
      // Fallback: try to map common field names
      const card = createBlankCard(String(obj.name ?? ""));
      card.data.description = String(obj.description ?? "");
      card.data.personality = String(obj.personality ?? "");
      card.data.scenario = String(obj.scenario ?? "");
      card.data.first_mes = String(obj.first_mes ?? obj.first_message ?? "");
      card.data.mes_example = String(obj.mes_example ?? obj.example_dialogs ?? "");
      card.data.system_prompt = String(obj.system_prompt ?? "");
      card.data.tags = Array.isArray(obj.tags) ? obj.tags.map(String) : [];
      card.data.creator = String(obj.creator ?? "");
      card.data.creator_notes = String(obj.creator_notes ?? "");
      card.data.character_version = String(
        obj.character_version ?? obj.version ?? card.data.character_version
      );
      return card;
    }
  }
}

// ─── What a platform would lose ───────────────────────────────────────────────

/**
 * Labels of the fields THIS card has content in that `platformId` drops or only
 * partly keeps. Empty fields are not listed: telling someone a platform drops
 * "alternate greetings" when the card has none is noise, and noise is what gets
 * a warning ignored.
 */
export function lossyFields(card: TavernCardV2, platformId: PlatformId): string[] {
  const used = new Set<string>();
  for (const [key, value] of Object.entries(card.data)) {
    const filled =
      Array.isArray(value) ? value.length > 0
      : value && typeof value === "object" ? Object.keys(value).length > 0
      : typeof value === "string" ? value.trim() !== "" && !(key === "character_version" && value === "1.0")
      : false;
    if (filled) used.add(key);
  }
  return PLATFORMS[platformId].fields
    .filter((f) => (f.support === "none" || f.support === "partial") && used.has(f.field))
    .map((f) => f.label);
}

// ─── Prompt Builder ────────────────────────────────────────────────────────────
// Assembles the system prompt from character definition + Core Memory Block.
// The enriched prompt replaces the simple `buildSystemPrompt(character)` used
// in ChatInput.tsx for bare character-only chats.

import type { Character, Persona } from "@/lib/types";
import type { CoreMemory } from "@/lib/db/models";

// ─── Token estimation ─────────────────────────────────────────────────────────

/**
 * Rough token count: ~4 chars per token for English prose.
 * Good enough for budget decisions; don't use for billing.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Core Memory formatter ────────────────────────────────────────────────────

/**
 * Renders the Core Memory Block as a compact, LLM-readable text section.
 * Target budget: ~400-600 tokens.
 */
export function formatCoreMemoryBlock(cm: CoreMemory): string {
  const lines: string[] = [];

  // ── Mood ─────────────────────────────────────────────────────────────────
  const moodDesc = describeVAD(cm.mood.valence, cm.mood.arousal, cm.mood.dominance);
  lines.push(`[Current Mood] ${moodDesc}`);

  // ── Relationship with user ────────────────────────────────────────────────
  const rel = cm.relationship_with_user;
  const relParts: string[] = [];
  if (rel.affection  !== 50) relParts.push(`affection ${signedPct(rel.affection)}`);
  if (rel.trust      !== 50) relParts.push(`trust ${signedPct(rel.trust)}`);
  if (rel.connection !== 50) relParts.push(`connection ${signedPct(rel.connection)}`);
  if (rel.desire     !== 50) relParts.push(`desire ${signedPct(rel.desire)}`);
  if (relParts.length > 0) {
    lines.push(`[Relationship with User] ${relParts.join(", ")}`);
  }
  if (cm.relationship_note) {
    lines.push(`[Between You] ${cm.relationship_note}`);
  }

  // ── Active commitments ────────────────────────────────────────────────────
  if (cm.active_commitments.length > 0) {
    lines.push(`[Active Commitments]`);
    for (const c of cm.active_commitments.slice(0, 5)) {
      lines.push(`  - ${c}`);
    }
  }

  // ── Internal thoughts ─────────────────────────────────────────────────────
  if (cm.internal_thoughts.length > 0) {
    lines.push(`[Internal Thoughts]`);
    for (const t of cm.internal_thoughts.slice(0, 3)) {
      lines.push(`  - ${t}`);
    }
  }

  // ── Recent emotional events ───────────────────────────────────────────────
  if (cm.recent_emotional_events.length > 0) {
    lines.push(`[Recent Emotional Events]`);
    for (const e of cm.recent_emotional_events.slice(0, 4)) {
      const sign = e.impact === "positive" ? "+" : e.impact === "negative" ? "-" : "~";
      lines.push(`  ${sign} ${e.description}`);
    }
  }

  // ── Narrative summary ─────────────────────────────────────────────────────
  if (cm.narrative_summary && cm.narrative_summary !== "The story is just beginning.") {
    lines.push(`[Story So Far] ${cm.narrative_summary}`);
  }

  return lines.join("\n");
}

// ─── Main system prompt builder ───────────────────────────────────────────────

/**
 * Builds the full system prompt injected before every LLM call.
 * Without core memory: ~200-300 tokens.
 * With core memory:    ~600-900 tokens.
 * With known facts:    +~100-200 tokens.
 */
export function buildSystemPrompt(
  character?:  Character | null,
  coreMemory?: CoreMemory | null,
  knownFacts?: string[],
  persona?:    Persona | null,
  episodes?:   string[],
  insights?:   string[],
  lore?:       string[]
): string {
  if (!character) return "You are a helpful assistant.";

  const sections: string[] = [];

  // ── Identity ──────────────────────────────────────────────────────────────
  sections.push(`You are ${character.name}. Stay in character throughout the entire conversation.`);

  if (character.description) sections.push(character.description);
  if (character.personality)  sections.push(`Personality: ${character.personality}`);
  if (character.scenario)     sections.push(`Current scenario: ${character.scenario}`);

  // ── User Persona ──────────────────────────────────────────────────────────
  if (persona) {
    const personaLines = [`The user is roleplaying as ${persona.name}.`];
    if (persona.description.trim()) personaLines.push(`About ${persona.name}: ${persona.description.trim()}`);
    personaLines.push(`Address and refer to the user as ${persona.name}, not "user".`);
    sections.push(`[User Persona]\n${personaLines.join("\n")}`);
  }

  // ── Core Memory Block (Drawer 1) ──────────────────────────────────────────
  if (coreMemory) {
    const persona = coreMemory.persona?.trim();
    if (persona && persona !== `${character.name} is a character in this story. Their personality and backstory will emerge through conversation.`) {
      sections.push(`[Core Persona]\n${persona}`);
    }

    const memBlock = formatCoreMemoryBlock(coreMemory);
    if (memBlock.trim()) {
      sections.push(memBlock);
    }
  }

  // ── Known Facts (Drawer 2 retrieval) ─────────────────────────────────────
  const facts = knownFacts?.slice(0, 20) ?? [];
  if (facts.length > 0) {
    const factLines = facts.map((f) => `  - ${f}`).join("\n");
    sections.push(`[Known Facts]\n${factLines}`);
  }

  // ── World lore (keyword-triggered lorebook entries) ──────────────────────
  if (lore && lore.length > 0) {
    sections.push(
      `[World Lore]\nEstablished facts about this world, relevant to the current scene:\n` +
      lore.map((l) => `  - ${l}`).join("\n")
    );
  }

  // ── Episodic memory: scenes remembered as events ─────────────────────────
  if (episodes && episodes.length > 0) {
    sections.push(`[Memorable Scenes]\n${episodes.map((e) => `  - ${e}`).join("\n")}`);
  }

  // ── Reflective insights: patterns the character has come to understand ───
  if (insights && insights.length > 0) {
    sections.push(`[What You Have Come To Understand]\n${insights.map((i) => `  - ${i}`).join("\n")}`);
  }

  // ── Instructions ──────────────────────────────────────────────────────────
  // The anti-confabulation line exists because absence of a memory otherwise
  // reads as licence to invent one — observed as a fabricated fear ("afraid of
  // cages") and an invented shared history in the long-run soaks.
  sections.push(
    `Write in first person. Be immersive and emotionally consistent with your current mood and relationship state. Do not break character or refer to yourself as an AI.\n` +
    `Your memory above is what you actually know. If asked about something not in your memory or this conversation, say you don't know or don't remember — do not invent specifics such as names, events, or promises.`
  );

  return sections.join("\n\n");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function signedPct(v: number): string {
  const delta = v - 50;
  if (delta > 20)  return "high";
  if (delta > 5)   return "above avg";
  if (delta < -20) return "low";
  if (delta < -5)  return "below avg";
  return "neutral";
}

function describeVAD(valence: number, arousal: number, dominance: number): string {
  const v = valence;   // -1 to 1
  const a = arousal;   // 0 to 1
  const d = dominance; // 0 to 1

  const mood =
    v >  0.5 ? "happy"      :
    v >  0.1 ? "content"    :
    v > -0.1 ? "neutral"    :
    v > -0.5 ? "melancholy" :
               "distressed";

  const energy =
    a > 0.7 ? "highly energised" :
    a > 0.4 ? "alert"            :
    a > 0.2 ? "calm"             :
              "very calm";

  const control =
    d > 0.7 ? "assertive"  :
    d > 0.4 ? "balanced"   :
              "deferential";

  return `${mood}, ${energy}, ${control}`;
}

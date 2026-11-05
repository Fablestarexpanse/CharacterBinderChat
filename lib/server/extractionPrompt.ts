// ─── The Drawer 2 extraction prompt ───────────────────────────────────────────
// Kept beside episodePrompts.ts rather than inside the extractor: the prompt is
// the part that gets rewritten and compared across runs, and it has no
// dependency on the store or the writes.

import type { MessageRole } from "@/lib/types";
import { promptDef } from "@/lib/prompts/defaults";
import { renderTemplate } from "@/lib/prompts/render";

export interface ExtractionPromptInput {
  messages:       Array<{ role: MessageRole; content: string; speaker?: string }>;
  characterName:  string;
  characterId:    string;
  /** Display name for the human side of the conversation */
  userLabel:      string;
  /** Entity id for the human side — the anchor the model must reuse */
  userId:         string;
  /** Existing entities, so the model reuses ids instead of minting new ones */
  knownEntities:  Array<{ id: string; name: string; type: string }>;
  /** Everyone in the scene, for group chats */
  participants:   Array<{ id: string; name: string }>;
}

export function buildExtractionPrompt({
  messages, characterName, characterId, userLabel, userId,
  knownEntities, participants,
}: ExtractionPromptInput, template = promptDef("memory.extraction").template): string {
  // Group messages carry an explicit speaker label; 1:1 falls back to role
  const conversation = messages
    .slice(-12)
    .map((m) => `${m.speaker ?? (m.role === "user" ? userLabel : characterName)}: ${m.content}`)
    .join("\n\n");

  // ── Identity anchor ───────────────────────────────────────────────────────
  // The participants already have ids in the database. Without stating
  // them the model mints its own ("ronan" next to "char-ronan"), and every
  // fact about the protagonist lands on an entity nothing ever reads back.
  const others = participants.filter((p) => p.id !== characterId && p.id !== userId);
  const anchorBlock = `PARTICIPANT IDS — these entities already exist. Use these exact ids as
subject/object/observer/target whenever the fact concerns them. Do NOT invent
alternative ids for them:
- ${characterId || "unknown"} = ${characterName} (the character speaking)
- ${userId} = ${userLabel} (the person they are talking to)
${others.map((p) => `- ${p.id} = ${p.name} (also present in the scene)`).join("\n")}

`;

  // ── Entity roster ─────────────────────────────────────────────────────────
  const rosterBlock = knownEntities.length > 0
    ? `EXISTING ENTITIES — reuse these exact ids when an entity reappears; only mint a
new snake_case id for an entity not in this list:
${knownEntities.slice(0, 40).map((e) => `- ${e.id} (${e.type}) "${e.name}"`).join("\n")}

`
    : "";

  return renderTemplate(template, {
    character_name:  characterName,
    // One fallback where the old text had three ("char_x", "the character's
    // id"); every real call has an id, so it only shows in hand-built tests.
    character_id:    characterId || "char_x",
    user_id:         userId,
    group_stat_rule: others.length > 0 ? `
  In this group scene, stat changes between ANY two listed participants are
  allowed when the conversation shows one — use their exact ids.` : "",
    participant_ids: anchorBlock,
    known_entities:  rosterBlock,
    conversation,
  });
}

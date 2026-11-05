// ─── Episode and reflection prompts ───────────────────────────────────────────
// What the model is asked for when a scene becomes a memory card: an EPISODE
// (a concrete event, written from the character's side) or, every few of those,
// a REFLECTION — a pattern noticed across events.

import { promptDef } from "@/lib/prompts/defaults";
import { renderTemplate } from "@/lib/prompts/render";

export function episodePrompt(
  conversation: string,
  characterName: string,
  userLabel: string,
  entityIds: string[],
  template = promptDef("memory.episode").template,
): string {
  return renderTemplate(template, {
    character_name:   characterName,
    user_label:       userLabel,
    known_entity_ids: entityIds.slice(0, 40).join(", ") || "(none yet)",
    conversation,
  });
}

export function reflectPrompt(
  facts: string[],
  episodes: string[],
  characterName: string,
  userLabel: string,
  template = promptDef("memory.reflection").template,
): string {
  return renderTemplate(template, {
    character_name: characterName,
    user_label:     userLabel,
    facts:          facts.map((f) => `- ${f}`).join("\n") || "(nothing)",
    episodes:       episodes.map((e) => `- ${e}`).join("\n") || "(none)",
  });
}

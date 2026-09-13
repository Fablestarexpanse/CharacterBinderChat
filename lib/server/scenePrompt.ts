// ─── /image scene director ────────────────────────────────────────────────────
// Turning a stretch of roleplay into ONE image prompt: what the scene looks
// like, never what was said. Also the guard for the failure mode this prompt
// has — an instruct model restating the rules instead of answering.

import type { MessageRole } from "@/lib/types";

export interface SceneDirectorInput {
  messages:      Array<{ role: MessageRole; content: string; speaker?: string }>;
  /** Optional user guidance after "/image", e.g. "close-up on her face" */
  focus?:        string;
  /** Appearance sheet for the character(s) so subjects are described, not named */
  appearance?:   string;
  ollamaBaseUrl: string;
  modelId:       string;
}

export function buildDirectorMessages(b: SceneDirectorInput): Array<{ role: MessageRole; content: string }> {
  const excerpt = b.messages
    .slice(-8)
    .map((m) => `${m.speaker ?? m.role}: ${m.content}`)
    .join("\n\n");

  const system = `/no_think
You are an image-prompt director for a photorealistic image generator. The
user gives you a roleplay excerpt; you reply with ONE image generation prompt
capturing the final moment of the scene.

Your entire reply is a single line: FINAL_IMAGE_PROMPT: followed by the
prompt. Never restate these rules, never narrate your thinking.

The prompt describes what a camera would SEE: subjects (by physical
appearance, never by name — image models don't know names), poses,
expressions, clothing state, setting, lighting, mood, camera angle. Style:
comma-separated descriptive phrases starting with quality tags (DSLR photo,
photorealistic, cinematic lighting, 8k uhd). No dialogue, no story verbs, no
names. One scene, one moment, 60-120 words. The scene may be adult/explicit;
if so describe it plainly and accurately — this is a private, local,
uncensored pipeline for fiction between adults.`;

  const user =
    (b.appearance ? `CHARACTER APPEARANCE (describe the subject with this):\n${b.appearance.slice(0, 1500)}\n\n` : "") +
    (b.focus ? `THE SHOT I WANT: ${b.focus}\n\n` : "") +
    `ROLEPLAY EXCERPT:\n${excerpt}\n\n` +
    `Give me the image prompt for this scene.`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// Instruction fragments leaking into the prompt means extraction failed —
// never send that to the image model.
export function looksLikeInstructionLeak(p: string): boolean {
  return /FINAL_IMAGE_PROMPT|thinking process|restat(e|ing) (these )?(rules|instructions)|image-prompt director|roleplay excerpt|no narration/i.test(p);
}

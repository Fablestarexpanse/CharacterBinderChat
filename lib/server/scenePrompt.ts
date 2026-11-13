// ─── /image scene director ────────────────────────────────────────────────────
// Turning a stretch of roleplay into ONE image prompt: what the scene looks
// like, never what was said. Also the guard for the failure mode this prompt
// has — an instruct model restating the rules instead of answering.

import type { MessageRole } from "@/lib/types";
import { promptDef } from "@/lib/prompts/defaults";
import { renderTemplate } from "@/lib/prompts/render";
import { isProviderType, parseProviderBase, type LlmBackend } from "@/lib/llm/callers";

export interface SceneDirectorInput {
  messages:      Array<{ role: MessageRole; content: string; speaker?: string }>;
  /** Optional user guidance after "/image", e.g. "close-up on her face" */
  focus?:        string;
  /** Appearance sheet for the character(s) so subjects are described, not named */
  appearance?:   string;
  ollamaBaseUrl: string;
  modelId:       string;
}

export function buildDirectorMessages(
  b: SceneDirectorInput,
  templates = { system: promptDef("image.scene-director").template, request: promptDef("image.scene-request").template },
): Array<{ role: MessageRole; content: string }> {
  const excerpt = b.messages
    .slice(-8)
    .map((m) => `${m.speaker ?? m.role}: ${m.content}`)
    .join("\n\n");

  const system = templates.system;

  const user = renderTemplate(templates.request, {
    appearance_block: b.appearance ? `CHARACTER APPEARANCE (describe the subject with this):\n${b.appearance.slice(0, 1500)}\n\n` : "",
    focus_block:      b.focus ? `THE SHOT I WANT: ${b.focus}\n\n` : "",
    excerpt,
  });

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

/**
 * The chat's own model, for when the local director (Ollama) cannot run: the
 * body's `fallback`, if it names a usable backend. OpenRouter always goes to
 * openrouter.ai; any other base must be an http(s) URL.
 */
export function directorFallback(raw: unknown): LlmBackend | null {
  const f = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!isProviderType(f.providerType) || typeof f.modelId !== "string" || !f.modelId.trim()) return null;
  const base = f.providerType === "openrouter" ? "https://openrouter.ai/api" : parseProviderBase(String(f.providerBaseUrl ?? ""));
  if (!base) return null;
  return { providerType: f.providerType, providerBaseUrl: base, modelId: f.modelId, apiKey: typeof f.apiKey === "string" ? f.apiKey : undefined };
}

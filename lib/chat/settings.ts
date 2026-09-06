// ─── Generation settings resolution ───────────────────────────────────────────
// Three layers collapse into what actually gets sent:
//
//   DEFAULT_GENERATION_PARAMS  ←  preset.params  ←  chat.settings
//
// Which preset applies is worked out at READ time (chat.presetId falling back
// to defaultPresetId), never snapshotted when the chat is created — so one
// rule covers new chats, old chats, and chats made before presets existed.

import { DEFAULT_GENERATION_PARAMS } from "@/lib/providers/params";
import type { Chat, Preset, PromptInstructions, ResolvedGeneration } from "@/lib/types";
import { normalizeForbiddenWords } from "@/lib/utils";

interface ResolveInput {
  presets: Preset[];
  defaultPresetId: string | null;
  globalInstructions: PromptInstructions;
}

/**
 * Merge global instructions, the chat's preset and its per-chat overrides.
 *
 * Params merge field-by-field. Prefill and forbidden words OVERRIDE rather
 * than concatenate: two prefills can't be meaningfully joined, and unioning
 * two ban lists would silently blow the cap.
 */
export function resolveGeneration(
  chat: Chat | undefined,
  { presets, defaultPresetId, globalInstructions }: ResolveInput
): ResolvedGeneration {
  const presetId = chat?.presetId ?? defaultPresetId ?? null;
  const preset = presetId ? presets.find((p) => p.id === presetId) : undefined;

  const params = {
    ...preset?.params,
    ...chat?.settings,
  };

  const prefill = (preset?.prefill ?? globalInstructions.prefill ?? "")
    // Trimmed once, here, so what is sent and what is saved are identical —
    // OpenRouter rejects an Anthropic prefill with trailing whitespace.
    .replace(/\s+$/, "");

  return {
    params,
    globalPrompt: globalInstructions.globalPrompt?.trim() || undefined,
    customPrompt: preset?.customPrompt?.trim() || undefined,
    prefill,
    forbiddenWords: normalizeForbiddenWords(
      preset?.forbiddenWords ?? globalInstructions.forbiddenWords ?? []
    ),
    presetId: preset?.id ?? null,
  };
}

/** The value a control should display: override, else preset, else default. */
export function effectiveParam<K extends keyof typeof DEFAULT_GENERATION_PARAMS>(
  key: K,
  params: Partial<typeof DEFAULT_GENERATION_PARAMS>
): number {
  return params[key] ?? DEFAULT_GENERATION_PARAMS[key];
}

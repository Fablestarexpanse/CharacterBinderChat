// ─── Sampler parameter mapping ────────────────────────────────────────────────
// The same knob has three different wire names across our backends (repetition
// penalty is `repeat_penalty` on Ollama and LM Studio but `repetition_penalty`
// on OpenRouter), and Ollama nests sampler args under `options` while the
// OpenAI-compatible providers keep them at the root. That translation lives
// here and nowhere else — the defaults used to be copy-pasted into all three
// providers plus the settings dialog.
//
// Kept out of factory.ts deliberately: factory.ts imports the provider classes,
// and the providers import this, so merging them would make an import cycle.

import type { GenerationParams, ParamKey, ModelInfo, ProviderId } from "@/lib/types";

export const DEFAULT_GENERATION_PARAMS: GenerationParams = {
  temperature:       0.8,
  maxTokens:         2048,
  contextSize:       8192,
  topP:              0.95,
  topK:              40,
  repetitionPenalty: 1.1,
  frequencyPenalty:  0,
  presencePenalty:   0,
};

/**
 * Params that are ALWAYS sent, defaulted when unset. Everything else is only
 * sent once the user explicitly sets it: pushing `top_k: 40` at an OpenAI
 * model because a default table said so is a setting that does nothing at
 * best, and a 400 from some OpenRouter providers at worst.
 */
const ALWAYS_SENT: ParamKey[] = ["temperature", "maxTokens", "topP"];

type Slot = "root" | "options";
interface FieldSpec { field: string; slot: Slot }

type SupportedProvider = "ollama" | "lmstudio" | "openrouter";

export const PARAM_MAP: Record<SupportedProvider, Partial<Record<ParamKey, FieldSpec>>> = {
  ollama: {
    temperature:       { field: "temperature",       slot: "options" },
    maxTokens:         { field: "num_predict",       slot: "options" },
    topP:              { field: "top_p",             slot: "options" },
    topK:              { field: "top_k",             slot: "options" },
    repetitionPenalty: { field: "repeat_penalty",    slot: "options" },
    frequencyPenalty:  { field: "frequency_penalty", slot: "options" },
    presencePenalty:   { field: "presence_penalty",  slot: "options" },
    // Reallocates the KV cache — the one place contextSize is more than a
    // client-side history budget.
    contextSize:       { field: "num_ctx",           slot: "options" },
  },
  lmstudio: {
    temperature:       { field: "temperature",       slot: "root" },
    maxTokens:         { field: "max_tokens",        slot: "root" },
    topP:              { field: "top_p",             slot: "root" },
    topK:              { field: "top_k",             slot: "root" },
    repetitionPenalty: { field: "repeat_penalty",    slot: "root" },
    frequencyPenalty:  { field: "frequency_penalty", slot: "root" },
    presencePenalty:   { field: "presence_penalty",  slot: "root" },
    // Context is fixed when the model is loaded; nothing to send.
  },
  openrouter: {
    temperature:       { field: "temperature",        slot: "root" },
    maxTokens:         { field: "max_tokens",         slot: "root" },
    topP:              { field: "top_p",              slot: "root" },
    topK:              { field: "top_k",              slot: "root" },
    repetitionPenalty: { field: "repetition_penalty", slot: "root" },
    frequencyPenalty:  { field: "frequency_penalty",  slot: "root" },
    presencePenalty:   { field: "presence_penalty",   slot: "root" },
    // Context is a property of the model, not a request parameter.
  },
};

/**
 * Translate provider-neutral params into one backend's wire shape.
 * Unsupported keys are dropped silently — that is the point of the table.
 */
export function buildRequestParams(
  providerId: ProviderId,
  params: Partial<GenerationParams>
): { root: Record<string, unknown>; options: Record<string, unknown> } {
  const map = PARAM_MAP[providerId as SupportedProvider] ?? PARAM_MAP.ollama;
  const root: Record<string, unknown> = {};
  const options: Record<string, unknown> = {};

  for (const [key, spec] of Object.entries(map) as Array<[ParamKey, FieldSpec]>) {
    const explicit = params[key];
    const value = explicit ?? (ALWAYS_SENT.includes(key) ? DEFAULT_GENERATION_PARAMS[key] : undefined);
    if (value === undefined || !Number.isFinite(value)) continue;
    (spec.slot === "options" ? options : root)[spec.field] = value;
  }
  return { root, options };
}

/**
 * Whether a control is worth rendering for this provider/model.
 * "model-dependent" means OpenRouter accepts the field but the chosen model's
 * upstream may ignore it — we only know once /models has reported.
 */
export function paramSupport(
  providerId: ProviderId,
  key: ParamKey,
  model?: ModelInfo
): "supported" | "unsupported" | "model-dependent" {
  const map = PARAM_MAP[providerId as SupportedProvider];
  if (!map?.[key]) return "unsupported";
  if (providerId !== "openrouter") return "supported";

  // OpenRouter proxies many upstreams; its /models payload lists what each
  // actually honours. Without that list we can't claim either way.
  if (!model?.supportedParameters) return "model-dependent";
  return model.supportedParameters.includes(map[key]!.field) ? "supported" : "unsupported";
}

// ─── A character's look, for image models ─────────────────────────────────────
// Short tags written for an image model (not the prose description the chat
// model reads), what to avoid, an optional LoRA trained on the character, and
// an optional fixed seed. Applied to every image of the character, so "silver
// hair, scar across the left jaw" is in the prompt every time instead of being
// paraphrased away by whoever wrote the scene prompt.
//
// Stored on Character/Persona as `image`; on a card it travels under
// `extensions.fablechat.image`, which other apps ignore.

import type { ImageGenerationSettings } from "@/lib/types";

export interface ImageLook {
  /** Comma-separated image tags, used word for word */
  tags?: string;
  /** Tags to keep out (added to the negative prompt) */
  avoid?: string;
  /** A LoRA trained on this character */
  lora?: { name: string; trigger?: string; weight?: number };
  /** A fixed seed: the same face and framing more often, at the cost of variety */
  seed?: number;
}

const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Keep only well-formed parts; undefined when nothing is left. Untrusted input (cards, agents) goes through this. */
export function cleanImageLook(raw: unknown): ImageLook | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: ImageLook = {};
  const tags = s(r.tags, 1000), avoid = s(r.avoid, 1000);
  if (tags) out.tags = tags;
  if (avoid) out.avoid = avoid;
  const l = r.lora as Record<string, unknown> | undefined;
  const name = l && typeof l === "object" ? s(l.name, 200) : "";
  if (name) {
    const trigger = s(l!.trigger, 200);
    const w = Number(l!.weight);
    out.lora = { name, ...(trigger ? { trigger } : {}), ...(Number.isFinite(w) && w !== 1 ? { weight: Math.min(2, Math.max(-2, Math.round(w * 100) / 100)) } : {}) };
  }
  const seed = Number(r.seed);
  if (r.seed !== undefined && r.seed !== null && r.seed !== "" && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff) out.seed = seed;
  return Object.keys(out).length ? out : undefined;
}

const joinTags = (...parts: Array<string | undefined>) => parts.map((p) => p?.trim().replace(/^,|,$/g, "").trim()).filter(Boolean).join(", ");

/**
 * Image settings with a character's look applied: trigger word and tags lead
 * the prompt (image models weigh early words most), avoid-tags join the
 * negative, the LoRA is added (once) and a fixed seed replaces "random".
 */
export function applyImageLook(settings: ImageGenerationSettings, look: ImageLook | undefined): ImageGenerationSettings {
  if (!look) return settings;
  const lead = joinTags(look.lora?.trigger, look.tags);
  const loras = look.lora && !settings.loras.some((x) => x.name === look.lora!.name)
    ? [...settings.loras, { name: look.lora.name, weight: look.lora.weight ?? 1 }]
    : settings.loras;
  return {
    ...settings,
    prompt: lead && !settings.prompt.startsWith(lead) ? joinTags(lead, settings.prompt) : settings.prompt,
    negativePrompt: joinTags(settings.negativePrompt, look.avoid),
    loras,
    seed: look.seed ?? settings.seed,
  };
}

/** Whether there is anything to apply (for "use this character's look" toggles). */
export const hasImageLook = (look: ImageLook | undefined) => !!look && Object.keys(look).length > 0;

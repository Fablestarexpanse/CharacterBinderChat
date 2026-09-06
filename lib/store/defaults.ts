// ─── Store defaults and helpers ───────────────────────────────────────────────
// Shared by the slices under ./slices. They live here rather than in index.ts
// so a slice can reach them without importing the module that imports it.

import type { ImageGenerationSettings, AspectRatio } from "@/lib/types";

// ─── Utility model ────────────────────────────────────────────────────────────
// Local Ollama model for background tasks that must never hit a cloud
// moderation layer — the /image scene director in particular. Read via
// `providerSettings.ollama.utilityModel ?? DEFAULT_UTILITY_MODEL` because
// persisted settings from before this field exist without it.
export const DEFAULT_UTILITY_MODEL =
  "hf.co/DavidAU/Qwen3.5-9B-The-Defiant-Fable-Uncensored-Heretic-NEO-IMATRIX-MAX-MTP-GGUF:Q6_K";

// ─── Default Image Settings ───────────────────────────────────────────────────

// Defaults match the Krea2 Turbo pipeline (the workflow whose models are
// actually installed on this machine): 8 steps, CFG 1, euler/simple.
export const defaultImageSettings: ImageGenerationSettings = {
  provider: "comfyui",
  workflow: "krea2-lora-pipeline",
  prompt: "",
  negativePrompt: "blurry, deformed, low quality, watermark",
  aspectRatio: "1:1" as AspectRatio,
  // 1225×1225 ≈ 1.5MP — the Krea2 v5 pipeline's speed/quality sweet spot
  width: 1225,
  height: 1225,
  steps: 8,
  cfg: 1,
  sampler: "euler",
  seed: -1,
  batchCount: 1,
  loras: [],
};

// ─── Empty defaults ───────────────────────────────────────────────────────────
// The app used to seed demo characters, a written-out sample chat and a
// "Neon City Lore" book. They were indistinguishable from real content, and
// the seeded lore actually injected into live prompts. A fresh install now
// starts genuinely empty; every section has an empty state that explains what
// to create first.

// ─── Ids ──────────────────────────────────────────────────────────────────────

/**
 * A readable, collision-free id: `char-ronan`, `char-ronan-2`.
 *
 * Characters and personas get slugs because their ids leave the store: a
 * character's id IS its Drawer 2 entity id, and reading a graph of
 * `char-ronan` beats reading one of `char-1735689600000-x7f2q`. Scenarios and
 * presets keep timestamp ids on purpose — nothing outside the store ever
 * derives an entity from them, so there is nothing to read them for.
 */
export function uniqueSlugId(prefix: string, name: string, taken: (id: string) => boolean): string {
  const base =
    name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || prefix;
  let id = `${prefix}-${base}`;
  for (let n = 2; taken(id); n++) id = `${prefix}-${base}-${n}`;
  return id;
}

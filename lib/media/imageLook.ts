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
  /** "Make pictures look like them": draw them with a likeness workflow (one with an image input) */
  likeness?: boolean;
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
  if (r.likeness === true) out.likeness = true;
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

// ─── Reference pictures ───────────────────────────────────────────────────────

export const MAX_REFERENCES = 4;

/**
 * The pictures to send for someone: their chosen reference set, or their avatar
 * when they have none. Only stored assets (never a pasted outside URL) and at most four.
 */
export function referencesFor(who: { avatar?: string; referenceImages?: string[] } | undefined): string[] {
  if (!who) return [];
  const own = (who.referenceImages ?? []).filter((u) => u.startsWith("/api/assets/"));
  const list = own.length ? own : who.avatar?.startsWith("/api/assets/") ? [who.avatar.split("?")[0]] : [];
  return [...new Set(list)].slice(0, MAX_REFERENCES);
}

export const withReferences = (settings: ImageGenerationSettings, refs: string[]): ImageGenerationSettings =>
  refs.length ? { ...settings, referenceImages: refs.slice(0, MAX_REFERENCES) } : settings;

/**
 * Put reference pictures into a workflow's image inputs: each picture is
 * uploaded (by `upload`, which returns the name ComfyUI stored it under) and its
 * node path is set to that name. Inputs beyond the pictures keep the workflow's
 * own image; pictures beyond the inputs are not sent. Returns how many were used.
 */
export async function injectReferences(
  workflow: Record<string, unknown>,
  nodePaths: string[] | undefined,
  refs: string[] | undefined,
  upload: (url: string) => Promise<string>,
): Promise<number> {
  const paths = (nodePaths ?? []).slice(0, MAX_REFERENCES);
  const pics = (refs ?? []).slice(0, paths.length);
  for (let i = 0; i < pics.length; i++) {
    const [nodeId, , key] = paths[i].split(".");
    const node = workflow[nodeId] as { inputs?: Record<string, unknown> } | undefined;
    if (!node?.inputs || !key) continue;
    node.inputs[key] = await upload(pics[i]);
  }
  // A picture slot nobody filled is taken out when everything it feeds is an
  // optional, growable input (H3's "ref_images.ref_image_2"): otherwise ComfyUI
  // loads the placeholder file and H3 is told about a person who is not there.
  // A slot feeding a required input keeps the workflow's own picture, as before.
  for (const p of paths.slice(pics.length)) {
    const nodeId = p.split(".")[0];
    const users = Object.values(workflow).flatMap((n) => {
      const inputs = (n as { inputs?: Record<string, unknown> } | null)?.inputs;
      return inputs ? Object.keys(inputs).filter((k) => Array.isArray(inputs[k]) && (inputs[k] as unknown[])[0] === nodeId).map((k) => ({ inputs, k })) : [];
    });
    if (users.length === 0 || !users.every((u) => u.k.includes("."))) continue;
    for (const u of users) delete u.inputs[u.k];
    delete workflow[nodeId];
  }
  return pics.length;
}

// ─── Likeness workflow ────────────────────────────────────────────────────────

/** The bundled identity workflow (workflows/sdxl-faceid-likeness.json) */
export const BUNDLED_LIKENESS = "sdxl-faceid-likeness";

interface WorkflowLike { slug: string; source: "bundled" | "imported"; purpose: string | null; controls: string[]; error?: string }

/**
 * The workflow to draw someone with when "make pictures look like them" is on:
 * one of the user's own photo/portrait workflows that takes reference images,
 * else the bundled likeness workflow, else none (then the usual one is used).
 */
export function likenessWorkflow(workflows: WorkflowLike[]): string | null {
  const ok = workflows.filter((w) => !w.error && w.controls.includes("referenceImage"));
  const mine = ok.find((w) => w.source === "imported" && (w.purpose === "photo" || w.purpose === "portrait"));
  if (mine) return mine.slug;
  return ok.find((w) => w.slug === BUNDLED_LIKENESS)?.slug ?? null;
}

/** Settings for a picture of someone: their look, their references and, when they asked for it, the likeness workflow. */
export function settingsForPerson(
  settings: ImageGenerationSettings,
  who: { image?: ImageLook; avatar?: string; referenceImages?: string[] } | undefined,
  workflows: WorkflowLike[],
): ImageGenerationSettings {
  if (!who) return settings;
  const refs = referencesFor(who);
  const out = withReferences(applyImageLook(settings, who.image), refs);
  const slug = who.image?.likeness && refs.length ? likenessWorkflow(workflows) : null;
  return slug ? { ...out, workflow: slug } : out;
}

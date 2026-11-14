// ─── Card art: what ComfyUI is asked to draw ──────────────────────────────────
// A character's card face is made by ComfyUI from options you pick (art style,
// border, what text it carries, what is behind them, anything else), not from a
// fixed frame. Two ways to draw it:
//
//  - "moss": MOSS-Image with a Layout prompt, so the name (and a tagline) are
//    lettered into the picture exactly where the layout puts them. They are
//    drawn from their look in words (tags, else their description) plus their
//    comic LoRA.
//  - "look": your usual picture settings through settingsForPerson (their
//    LoRA, reference pictures and likeness), so it looks most like them; image
//    models letter badly, so the name is laid over the picture afterwards.
//
// Every card is a Magic card's size, 63 x 88 mm (lib/cards/tradingCard.ts). Pure and client-safe; the
// prompt text is the editable `image.card-art` / `image.card-moss` templates.

import type { LayoutDraft } from "@/lib/media/comicPage";

export type CardEngine = "moss" | "look";
export type CardTextChoice = "name" | "name-tagline" | "none";

export interface CardArtOptions {
  engine: CardEngine;
  /** A CARD_STYLES id, or "custom" with `customStyle` */
  style: string;
  customStyle?: string;
  /** A CARD_FRAMES id, or "custom" with `customFrame` */
  frame: string;
  customFrame?: string;
  text: CardTextChoice;
  nameAt: "top" | "bottom";
  /** What is behind them */
  background?: string;
  /** Anything else to ask for */
  extra?: string;
}

export const CARD_STYLES = [
  { id: "painted", label: "Painted fantasy", prompt: "richly painted digital fantasy illustration, dramatic lighting" },
  { id: "anime", label: "Anime", prompt: "anime cel-shaded illustration, clean line art, vivid colours" },
  { id: "photo", label: "Cinematic photo", prompt: "cinematic photograph, shallow depth of field, soft film grain" },
  { id: "watercolour", label: "Watercolour", prompt: "loose watercolour painting on textured paper, soft washes" },
  { id: "ink", label: "Comic ink", prompt: "bold comic-book inks with flat colours and halftone shading" },
  { id: "noir", label: "Noir", prompt: "high-contrast black and white noir illustration, deep shadows" },
  { id: "neon", label: "Neon sci-fi", prompt: "neon-lit cyberpunk illustration, glowing rim light, rain" },
  { id: "nouveau", label: "Art nouveau", prompt: "art nouveau poster illustration, flowing lines, muted gold and teal palette" },
  { id: "storybook", label: "Storybook", prompt: "gentle storybook gouache illustration, warm colours" },
] as const;

export const CARD_FRAMES = [
  { id: "none", label: "No border (art to the edges)", prompt: "the art fills the whole card edge to edge, no border" },
  { id: "thin", label: "Thin border", prompt: "a thin clean single-colour border around the card" },
  { id: "ornate", label: "Ornate filigree", prompt: "an ornate carved filigree border" },
  { id: "foil", label: "Holographic foil", prompt: "a holographic foil border with a rainbow sheen" },
  { id: "deco", label: "Art deco", prompt: "an art deco border of thin gold geometric lines" },
  { id: "tech", label: "Sci-fi panel", prompt: "a sci-fi interface border with glowing panel lines" },
  { id: "nature", label: "Vines and leaves", prompt: "a border of twisting vines and leaves" },
] as const;

export const DEFAULT_CARD_OPTIONS: CardArtOptions = {
  engine: "moss", style: "painted", frame: "none", text: "name", nameAt: "bottom",
};

/** The picture sizes asked of ComfyUI: as close to 63:88 as multiples of 16 allow (the card crops the rest) */
export const CARD_ART_SIZE = { moss: { width: 1024, height: 1424 }, look: { width: 832, height: 1168 } } as const;

const clip = (s: string | undefined, max: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function styleText(o: CardArtOptions): string {
  if (o.style === "custom") return clip(o.customStyle, 300) || CARD_STYLES[0].prompt;
  return CARD_STYLES.find((s) => s.id === o.style)?.prompt ?? CARD_STYLES[0].prompt;
}

export function frameText(o: CardArtOptions): string {
  if (o.frame === "custom") return clip(o.customFrame, 300) || CARD_FRAMES[0].prompt;
  return CARD_FRAMES.find((f) => f.id === o.frame)?.prompt ?? CARD_FRAMES[0].prompt;
}

/** Options from anywhere (a saved row, a form) made safe to use */
export function cleanCardOptions(raw: unknown): CardArtOptions {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : undefined);
  const style = s("style");
  const frame = s("frame");
  return {
    engine: r.engine === "look" ? "look" : "moss",
    style: style && (style === "custom" || CARD_STYLES.some((x) => x.id === style)) ? style : DEFAULT_CARD_OPTIONS.style,
    ...(clip(s("customStyle"), 300) ? { customStyle: clip(s("customStyle"), 300) } : {}),
    frame: frame && (frame === "custom" || CARD_FRAMES.some((x) => x.id === frame)) ? frame : DEFAULT_CARD_OPTIONS.frame,
    ...(clip(s("customFrame"), 300) ? { customFrame: clip(s("customFrame"), 300) } : {}),
    text: r.text === "none" || r.text === "name-tagline" ? r.text : "name",
    nameAt: r.nameAt === "top" ? "top" : "bottom",
    ...(clip(s("background"), 300) ? { background: clip(s("background"), 300) } : {}),
    ...(clip(s("extra"), 400) ? { extra: clip(s("extra"), 400) } : {}),
  };
}

/** Commas left by empty variables ("a, , b,") folded away */
export function tidyPrompt(p: string): string {
  return p.replace(/\s+/g, " ").replace(/(\s*,\s*)+/g, ", ").replace(/^\s*,\s*|\s*,\s*$/g, "").replace(/\s+\./g, ".").trim();
}

/** The values for `image.card-art` (the "look" engine; their image tags are added in front by applyImageLook) */
export function cardArtVariables(o: CardArtOptions): Record<string, string> {
  return { style: styleText(o), frame: frameText(o), background: clip(o.background, 300), extra: clip(o.extra, 400) };
}

/**
 * The MOSS layout for a card: one figure over most of the card, and the name
 * (and tagline) in boxes so MOSS letters them exactly. `caption` is the rendered
 * `image.card-moss` template (the global description).
 */
export function cardMossLayout(
  o: CardArtOptions, person: { name: string; look: string; tagline?: string }, caption: string,
): LayoutDraft {
  const { width: W, height: H } = CARD_ART_SIZE.moss;
  const items: LayoutDraft["items"] = [];
  const top = o.nameAt === "top";
  const withText = o.text !== "none";
  const withTagline = o.text === "name-tagline" && !!person.tagline?.trim();
  const nameBox: [number, number, number, number] = top ? [96, 56, W - 96, 176] : [96, H - (withTagline ? 290 : 190), W - 96, H - (withTagline ? 180 : 70)];
  const figure: [number, number, number, number] = [72, top ? 200 : 72, W - 72, withText ? (top ? H - (withTagline ? 190 : 72) : nameBox[1] - 24) : H - 72];
  items.push({ label: "character", caption: `The person on the card, the only figure: ${clip(person.look, 500)}`, bbox: figure });
  if (withText) {
    items.push({ label: "text", caption: "The name plate: large, clear, elegant lettering that suits the card's style and border, perfectly legible", text: clip(person.name, 40), bbox: nameBox });
  }
  if (withTagline) {
    const box: [number, number, number, number] = [120, H - 170, W - 120, H - 64];
    items.push({ label: "text", caption: "A short line in small italic lettering on a plain band, perfectly legible", text: clip(person.tagline, 90), bbox: box });
  }
  return { width: W, height: H, bbox_coord_space: "abs", bbox_format: "xyxy", summary: { caption, meta: ["character card", "portrait orientation"], canvas: "multi_panel" }, items };
}

/** The values for `image.card-moss` (the global description of a MOSS card) */
export function cardMossVariables(o: CardArtOptions, person: { name: string; look: string; tagline?: string }): Record<string, string> {
  const withTagline = o.text === "name-tagline" && !!person.tagline?.trim();
  const lettering = o.text === "none"
    ? "There is no text anywhere on the card."
    : `The only text on the card is the name "${clip(person.name, 40)}"${withTagline ? ` and the line "${clip(person.tagline, 90)}"` : ""}, each lettered exactly in its own box; no other text, letters or numbers anywhere.`;
  return {
    style: styleText(o), frame: frameText(o), look: clip(person.look, 500),
    background: clip(o.background, 300) || "a backdrop that suits them", extra: clip(o.extra, 400), lettering,
  };
}

/** A tagline short enough to letter: the description's first sentence, at most 90 characters */
export function shortTagline(tagline: string): string {
  const first = tagline.split(/(?<=[.!?])\s+/)[0] ?? "";
  if (first.length <= 90) return first;
  return first.slice(0, 89).replace(/\s+\S*$/, "") + "…";
}

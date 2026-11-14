// ─── Card face ────────────────────────────────────────────────────────────────
// The finished card is a Magic card's size exactly: 63 x 88 mm, drawn at 300 DPI
// (744 x 1039) and stamped 300 DPI, so it prints at true size. Its look is the
// art ComfyUI drew from the options you picked (lib/cards/cardArt.ts); this
// file only fits that art to the card and, when the art carries no lettering
// (your picture settings, or no art yet, so the portrait), lays the name and
// tagline over it on a soft shade. No fixed frame: the border, if any, is in the
// art. The card's data is not drawn: it rides inside the PNG (lib/cards/export.ts).
//
// The text helpers are pure and tested; `composeCardFace` needs a canvas.

import type { Character } from "@/lib/types";
import { expandMacros } from "./tavern";
import { withDpi } from "./png";

/** 63 x 88 mm at 300 DPI */
export const CARD_MM = { width: 63, height: 88 } as const;
export const CARD_DPI = 300;
export const CARD_W = Math.round((CARD_MM.width / 25.4) * CARD_DPI);    // 744
export const CARD_H = Math.round((CARD_MM.height / 25.4) * CARD_DPI);   // 1039

/** Colours for a card with no picture at all, picked from the name so a character keeps theirs. */
export const CARD_THEMES = [
  { frame: "#7a1f2b", light: "#c4505e", name: "crimson" },
  { frame: "#1f3d7a", light: "#5078c4", name: "sapphire" },
  { frame: "#1f5e3d", light: "#4fa173", name: "emerald" },
  { frame: "#4b2a7a", light: "#8a63c4", name: "amethyst" },
  { frame: "#7a5a1f", light: "#c49a4f", name: "amber" },
  { frame: "#2f3a45", light: "#6f8496", name: "slate" },
] as const;

export function cardTheme(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return CARD_THEMES[h % CARD_THEMES.length];
}

/** One or two sentences from the description (card placeholders filled), at most `max` characters. */
export function cardTagline(c: Pick<Character, "name" | "description">, max = 220): string {
  const text = expandMacros(c.description ?? "", { char: c.name, user: "you" })
    .replace(/[*_#>`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  // A sentence ends at . ! ? followed by a space or the end, so "88.7" or "St. Ives" stay whole
  const sentences = text.split(/(?<=[.!?]["')\]]?)\s+/);
  let out = "";
  for (const s of sentences) {
    const next = (out + " " + s.trim()).trim();
    if (next.length > max) break;
    out = next;
    if (out.length > max * 0.55) break;
  }
  if (!out) out = text.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
  return out;
}

/**
 * Greedy word wrap with a measuring function (the canvas's measureText in the
 * app, a character count in tests). Past `maxLines` the last line ends in "…".
 */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (measure(next) <= maxWidth || !line) { line = next; continue; }
    lines.push(line);
    line = w;
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && measure(`${last}…`) > maxWidth) last = last.replace(/\s*\S+$/, "");
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

// ─── Drawing (browser) ────────────────────────────────────────────────────────

function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: string, size: number, min: number, width: number, family: string) {
  let s = size;
  for (; s > min; s -= 1) {
    ctx.font = `${weight} ${s}px ${family}`;
    if (ctx.measureText(text).width <= width) break;
  }
  ctx.font = `${weight} ${s}px ${family}`;
}

const SERIF = 'Georgia, "Times New Roman", serif';

export interface CardFaceText {
  name: string;
  /** Laid over the art only when set */
  tagline?: string;
  nameAt: "top" | "bottom";
}

type Drawable = CanvasImageSource & { width: number; height: number };

/**
 * The card: `art` fitted to CARD_W x CARD_H (cover, biased to the top so faces stay
 * in), or a plain colour with their initial when there is none; `overlay` lays
 * the name (and tagline) over it. Returns PNG bytes.
 */
export async function composeCardFace(art: Drawable | null, name: string, overlay: CardFaceText | null): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");

  if (art && art.width && art.height) {
    const scale = Math.max(CARD_W / art.width, CARD_H / art.height);
    const dw = art.width * scale, dh = art.height * scale;
    ctx.drawImage(art, (CARD_W - dw) / 2, Math.min(0, (CARD_H - dh) * 0.2), dw, dh);
  } else {
    const theme = cardTheme(name);
    const g = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
    g.addColorStop(0, theme.light);
    g.addColorStop(1, theme.frame);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CARD_W, CARD_H);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = `bold 280px ${SERIF}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((name.trim()[0] ?? "?").toUpperCase(), CARD_W / 2, CARD_H * 0.42);
  }

  if (overlay) {
    const top = overlay.nameAt === "top";
    const tagline = overlay.tagline?.trim() ?? "";
    ctx.font = `italic 22px ${SERIF}`;
    const tagLines = tagline ? wrapLines(tagline, CARD_W - 96, (s) => ctx.measureText(s).width, 3) : [];
    const band = 110 + tagLines.length * 30;
    const shade = top ? ctx.createLinearGradient(0, 0, 0, band + 60) : ctx.createLinearGradient(0, CARD_H, 0, CARD_H - band - 60);
    shade.addColorStop(0, "rgba(0,0,0,0.78)");
    shade.addColorStop(0.65, "rgba(0,0,0,0.45)");
    shade.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shade;
    if (top) ctx.fillRect(0, 0, CARD_W, band + 60); else ctx.fillRect(0, CARD_H - band - 60, CARD_W, band + 60);

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 8;
    fitFont(ctx, overlay.name, "bold", 54, 26, CARD_W - 96, SERIF);
    const nameY = top ? 86 : CARD_H - 44 - tagLines.length * 30;
    ctx.fillText(overlay.name, 48, nameY);
    ctx.font = `italic 22px ${SERIF}`;
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    tagLines.forEach((l, i) => ctx.fillText(l, 50, nameY + 36 + i * 30));
    ctx.shadowBlur = 0;
  }

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("Could not draw the card");
  return withDpi(new Uint8Array(await blob.arrayBuffer()), CARD_DPI);
}

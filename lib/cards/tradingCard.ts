// ─── Trading-card face ────────────────────────────────────────────────────────
// Draws a character as a collectible card (750 x 1050, the poker-card ratio):
// a framed portrait, a name banner, a type line of tags, a text box with a
// tagline from the description, and a footer with creator and version. The
// card's data is not drawn: it rides inside the PNG (lib/cards/export.ts).
//
// The layout helpers are pure and tested; `drawCardFace` needs a canvas.

import type { Character } from "@/lib/types";
import { expandMacros } from "./tavern";

export const CARD_W = 750;
export const CARD_H = 1050;

/** Frame colours, picked from the name so a character keeps theirs across exports. */
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
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]?|[^.!?]+$/g) ?? [text];
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

/** The type line: "Character — tag · tag · tag". */
export function cardTypeLine(tags: string[], max = 4): string {
  const shown = tags.map((t) => t.trim()).filter(Boolean).slice(0, max);
  return shown.length ? `Character — ${shown.join(" · ")}` : "Character";
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Fit `text` on one line at the largest size from `size` down to `min`. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: string, size: number, min: number, width: number, family: string) {
  let s = size;
  for (; s > min; s -= 1) {
    ctx.font = `${weight} ${s}px ${family}`;
    if (ctx.measureText(text).width <= width) break;
  }
  ctx.font = `${weight} ${s}px ${family}`;
}

const SERIF = 'Georgia, "Times New Roman", serif';

export interface CardFaceInput {
  name: string;
  description: string;
  tags: string[];
  creator?: string;
  characterVersion?: string;
}

/** Draws the face onto a new canvas and returns it as PNG bytes. `portrait` is any loaded image, or null. */
export async function drawCardFace(c: CardFaceInput, portrait: CanvasImageSource & { width: number; height: number } | null): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  const theme = cardTheme(c.name);

  // Outer frame
  roundRect(ctx, 0, 0, CARD_W, CARD_H, 36);
  const frame = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  frame.addColorStop(0, theme.light);
  frame.addColorStop(0.5, theme.frame);
  frame.addColorStop(1, theme.light);
  ctx.fillStyle = frame;
  ctx.fill();
  roundRect(ctx, 18, 18, CARD_W - 36, CARD_H - 36, 24);
  ctx.fillStyle = "#16121c";
  ctx.fill();
  ctx.strokeStyle = "#d9b45a";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Name banner
  const bannerY = 34, bannerH = 70;
  roundRect(ctx, 34, bannerY, CARD_W - 68, bannerH, 14);
  const banner = ctx.createLinearGradient(0, bannerY, 0, bannerY + bannerH);
  banner.addColorStop(0, "#f4ead2");
  banner.addColorStop(1, "#dccaa0");
  ctx.fillStyle = banner;
  ctx.fill();
  ctx.strokeStyle = theme.frame;
  ctx.lineWidth = 3;
  ctx.stroke();
  const version = c.characterVersion?.trim() ? `v${c.characterVersion.trim().replace(/^v/i, "")}` : "";
  ctx.fillStyle = "#4a3b22";
  ctx.font = `italic 20px ${SERIF}`;
  const vW = version ? ctx.measureText(version).width + 16 : 0;
  if (version) { ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(version, CARD_W - 54, bannerY + bannerH / 2); }
  ctx.fillStyle = "#1d1508";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  fitFont(ctx, c.name, "bold", 40, 22, CARD_W - 108 - vW, SERIF);
  ctx.fillText(c.name, 54, bannerY + bannerH / 2 + 1);

  // Portrait window
  const px = 46, py = 120, pw = CARD_W - 92, ph = 560;
  ctx.save();
  roundRect(ctx, px, py, pw, ph, 12);
  ctx.clip();
  if (portrait && portrait.width && portrait.height) {
    // Cover, biased to the top so faces stay in
    const scale = Math.max(pw / portrait.width, ph / portrait.height);
    const dw = portrait.width * scale, dh = portrait.height * scale;
    ctx.drawImage(portrait, px + (pw - dw) / 2, py + Math.min(0, (ph - dh) * 0.2), dw, dh);
  } else {
    const g = ctx.createLinearGradient(px, py, px + pw, py + ph);
    g.addColorStop(0, theme.light);
    g.addColorStop(1, theme.frame);
    ctx.fillStyle = g;
    ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = `bold 220px ${SERIF}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((c.name.trim()[0] ?? "?").toUpperCase(), px + pw / 2, py + ph / 2);
  }
  ctx.restore();
  roundRect(ctx, px, py, pw, ph, 12);
  ctx.strokeStyle = "#d9b45a";
  ctx.lineWidth = 4;
  ctx.stroke();

  // Type line
  const typeY = py + ph + 14, typeH = 52;
  roundRect(ctx, 34, typeY, CARD_W - 68, typeH, 12);
  ctx.fillStyle = banner;
  ctx.fill();
  ctx.strokeStyle = theme.frame;
  ctx.lineWidth = 3;
  ctx.stroke();
  const typeLine = cardTypeLine(c.tags);
  ctx.fillStyle = "#1d1508";
  ctx.textAlign = "left";
  fitFont(ctx, typeLine, "bold", 24, 15, CARD_W - 108, SERIF);
  ctx.fillText(typeLine, 54, typeY + typeH / 2 + 1);

  // Text box
  const boxY = typeY + typeH + 12, boxH = CARD_H - boxY - 78;
  roundRect(ctx, 46, boxY, CARD_W - 92, boxH, 10);
  ctx.fillStyle = "#efe6cf";
  ctx.fill();
  ctx.strokeStyle = "#b9a170";
  ctx.lineWidth = 2;
  ctx.stroke();
  const tagline = cardTagline(c) || "A character for FableChat.";
  ctx.fillStyle = "#24190b";
  ctx.textBaseline = "top";
  let size = 26;
  let lines: string[] = [];
  for (; size >= 17; size -= 1) {
    ctx.font = `italic ${size}px ${SERIF}`;
    lines = wrapLines(tagline, CARD_W - 140, (s) => ctx.measureText(s).width, Math.floor((boxH - 36) / (size * 1.3)));
    if (!lines[lines.length - 1]?.endsWith("…")) break;
  }
  const textH = lines.length * size * 1.3;
  let ty = boxY + Math.max(18, (boxH - textH) / 2);
  for (const l of lines) { ctx.fillText(l, 70, ty); ty += size * 1.3; }

  // Footer
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#e9dcb8";
  ctx.font = `15px ${SERIF}`;
  ctx.textAlign = "left";
  const creator = c.creator?.trim() ? `Created by ${c.creator.trim()}` : "";
  if (creator) ctx.fillText(creator.length > 48 ? `${creator.slice(0, 47)}…` : creator, 50, CARD_H - 48);
  ctx.textAlign = "right";
  ctx.fillText("FableChat card", CARD_W - 50, CARD_H - 48);

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("Could not draw the card");
  return new Uint8Array(await blob.arrayBuffer());
}

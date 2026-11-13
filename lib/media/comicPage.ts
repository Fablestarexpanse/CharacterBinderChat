// ─── Comic-it: a comic page from the chat ─────────────────────────────────────
// The background model writes the SCRIPT (lib/prompts "image.comic-script"):
// panels, each with a shot, who is in it, speech balloons and an optional
// narration box. It never writes coordinates; a 4B model cannot place boxes
// reliably. This file does the rest, deterministically: the panel grid, the
// box for every panel, figure, balloon and caption on a 1024x1536 page, the
// global description (style, grid, every character's look, the lettering
// rule), and the compile into MOSS-Image's Layout prompt (abs_centralized,
// yxyx), ported from the official moss-image-prompt-enhancer compile_prompt.py.
// MOSS-Image draws boxed text well, which is why the page goes to MOSS.
//
// Pure and client-safe; the script itself is untrusted model output and goes
// through cleanComicScript first.

export const PAGE = { width: 1024, height: 1536, margin: 16, gutter: 12 } as const;
export const MAX_PANELS = 6;
const MAX_BALLOONS = 2;
const MAX_LINE = 110;
/** A "balloon" that is only an action or a sound of one ("sigh.", "laughs", "nods") */
const ACTION_ONLY = /^(a\s+)?(quiet\s+|soft\s+|small\s+)?(sigh|sighs|laugh|laughs|chuckle|chuckles|nod|nods|smile|smiles|shrug|shrugs|pause|gasp|gasps|sniff|sniffs|groan|groans)[.!…\s]*$/i;

export interface ComicBalloon { speaker: string; text: string }
export interface ComicPanel { shot: string; characters: string[]; balloons: ComicBalloon[]; caption?: string }
export interface ComicScript { title?: string; setting?: string; panels: ComicPanel[] }

/** Someone who can appear on the page, and how image models should draw them */
export interface ComicPerson { name: string; look: string }

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
/** Balloon text: no stage directions, no wrapping quotes or asterisks, at most MAX_LINE characters */
const line = (v: unknown) => {
  let t = str(v, 400).replace(/\*[^*]*\*/g, " ").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().replace(/^["“”']+|["“”']+$/g, "").trim();
  if (t.length > MAX_LINE) t = `${t.slice(0, MAX_LINE - 1).replace(/\s+\S*$/, "")}…`;
  return t;
};

/**
 * The model's script made safe: 1..MAX_PANELS panels, at most two balloons each,
 * speakers and figures matched to the people given (case-insensitive, by full or
 * first name), lines without stage directions. null when nothing usable is left.
 */
export function cleanComicScript(raw: unknown, people: ComicPerson[]): ComicScript | null {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const match = (name: unknown) => {
    const n = str(name, 100).toLowerCase();
    if (!n) return null;
    return people.find((p) => p.name.toLowerCase() === n || p.name.split(/\s+/)[0].toLowerCase() === n.split(/\s+/)[0])?.name ?? null;
  };
  const panels: ComicPanel[] = [];
  for (const rp of Array.isArray(r.panels) ? r.panels : []) {
    if (panels.length >= MAX_PANELS) break;
    const p = (rp && typeof rp === "object" ? rp : {}) as Record<string, unknown>;
    const shot = str(p.shot ?? p.description, 300);
    if (!shot) continue;
    const balloons: ComicBalloon[] = [];
    for (const rb of Array.isArray(p.balloons) ? p.balloons : []) {
      if (balloons.length >= MAX_BALLOONS) break;
      const b = (rb && typeof rb === "object" ? rb : {}) as Record<string, unknown>;
      const speaker = match(b.speaker), text = line(b.text);
      // An action turned into a balloon ("sigh.", "*laughs*") is not speech
      if (speaker && text && !ACTION_ONLY.test(text)) balloons.push({ speaker, text });
    }
    const named = (Array.isArray(p.characters) ? p.characters : []).map(match).filter((n): n is string => !!n);
    const characters = [...new Set([...named, ...balloons.map((b) => b.speaker)])].slice(0, 3);
    const caption = line(p.caption ?? p.narration);
    panels.push({ shot, characters, balloons, ...(caption ? { caption } : {}) });
  }
  if (panels.length === 0) return null;
  const title = str(r.title, 80), setting = str(r.setting, 300);
  return { ...(title ? { title } : {}), ...(setting ? { setting } : {}), panels };
}

export type Box = [number, number, number, number];

/** Panels per tier for a page of n panels, top to bottom */
export function tiers(n: number): number[] {
  return ([[1], [1, 1], [1, 2], [2, 2], [2, 1, 2], [2, 2, 2]] as number[][])[Math.max(1, Math.min(MAX_PANELS, n)) - 1];
}

/** The panel rectangles, in reading order, inside the page margin with gutters between them */
export function panelBoxes(n: number, page = PAGE): Box[] {
  const rows = tiers(n);
  const innerW = page.width - 2 * page.margin, innerH = page.height - 2 * page.margin;
  const rowH = (innerH - page.gutter * (rows.length - 1)) / rows.length;
  const out: Box[] = [];
  rows.forEach((cols, r) => {
    const y1 = page.margin + r * (rowH + page.gutter);
    const colW = (innerW - page.gutter * (cols - 1)) / cols;
    for (let c = 0; c < cols; c++) {
      const x1 = page.margin + c * (colW + page.gutter);
      out.push([Math.round(x1), Math.round(y1), Math.round(x1 + colW), Math.round(y1 + rowH)]);
    }
  });
  return out;
}

/** A box at fractions of a panel */
const within = (p: Box, fx1: number, fy1: number, fx2: number, fy2: number): Box => {
  const w = p[2] - p[0], h = p[3] - p[1];
  return [Math.round(p[0] + fx1 * w), Math.round(p[1] + fy1 * h), Math.round(p[0] + fx2 * w), Math.round(p[1] + fy2 * h)];
};

/** Line breaks so the words fit a box of this width (about 15 px a character at comic-lettering size) */
export function wrap(text: string, boxWidth: number): string {
  const per = Math.max(10, Math.floor(boxWidth / 15));
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(" ")) {
    if (cur && (cur + " " + word).length > per) { lines.push(cur); cur = word; } else cur = cur ? `${cur} ${word}` : word;
  }
  if (cur) lines.push(cur);
  return lines.join("\n");
}

const gridWords = (n: number) => {
  const rows = tiers(n);
  const say = (c: number) => (c === 1 ? "one wide panel" : `${c} panels side by side`);
  return `${n} panel${n === 1 ? "" : "s"} in ${rows.length} tier${rows.length === 1 ? "" : "s"} (${rows.map(say).join(", then ")})`;
};

export interface LayoutDraft {
  width: number; height: number; bbox_coord_space: "abs"; bbox_format: "xyxy";
  summary: { caption: string; meta: string[]; canvas: "multi_panel" };
  items: Array<{ label: "object" | "character" | "text"; caption: string; bbox: Box; text?: string }>;
}

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * How someone looks, for a page, when they have no image tags: the "Appearance:"
 * part of their description if it has one, else the sentences that describe a
 * body or clothes, else its start. Image tags are always better; the page says so.
 */
export function lookFromDescription(description: string): string {
  const d = description.replace(/\(A demo [^)]*\)/g, "").trim();
  const section = /Appearance:\s*([^\n]+)/i.exec(d)?.[1];
  if (section) return section.trim().slice(0, 400);
  const visual = /\b(hair|eyes?|skin|freckle|beard|tall|slight|lean|broad|build|wears?|wearing|jacket|coat|dress|glasses|scar|tattoo)\w*/i;
  const sentences = d.split(/(?<=[.!?])\s+/).filter((s) => visual.test(s));
  return (sentences.join(" ") || d).slice(0, 400);
}

/** The whole page as a Layout draft (absolute pixels, xyxy) */
export function layoutComicPage(script: ComicScript, people: ComicPerson[], style: string, page = PAGE): LayoutDraft {
  const n = script.panels.length;
  const boxes = panelBoxes(n, page);
  const onPage = people.filter((p) => script.panels.some((pn) => pn.characters.includes(p.name)));
  // Names never reach the picture: an image model draws a name as writing (on a shirt, a sign).
  // Each person is their look; a short form of it ("the woman with …") stands in for their name.
  const look = (name: string) => people.find((p) => p.name === name)?.look || "a person";
  const short = (name: string) => `the person with ${look(name).split(",").map((t) => t.trim()).filter(Boolean).slice(1, 4).join(", ") || look(name)}`;
  const unnamed = (text: string) => people.reduce((t, p) => {
    const first = p.name.split(/\s+/)[0];
    return t.replace(new RegExp(`\\b${escapeRe(p.name)}('s)?\\b`, "gi"), short(p.name))
      .replace(new RegExp(`\\b${escapeRe(first)}('s)?\\b`, "g"), short(p.name));
  }, text);
  const caption = [
    style.trim() || "Full-colour graphic-novel page, clean confident ink lines and soft painted colour",
    `A comic page of ${gridWords(n)}, each panel enclosed by a thin hand-ruled black border with white gutters between them.`,
    script.setting ? `Setting: ${unnamed(script.setting)}.` : "",
    onPage.length ? `${onPage.length === 1 ? "One person" : `${onPage.length} different people, never mixed: each keeps only their own hair, face and clothes, and props belong to whoever is described with them`}, drawn the same in every panel: ${onPage.map((p, k) => `(${k + 1}) ${p.look}`).join("; ")}.` : "",
    "Lettering: white oval speech balloons with a tail pointing to whoever speaks, clean hand-lettered comic font, every word spelled exactly as given; cream rectangular narration boxes; no other text anywhere on the page, no names or words on clothing.",
  ].filter(Boolean).join(" ");
  const items: LayoutDraft["items"] = [];
  script.panels.forEach((pn, i) => {
    const p = boxes[i];
    items.push({ label: "object", caption: `Panel ${i + 1}: ${unnamed(pn.shot)}`, bbox: p });
    // Figures share the lower part of the panel, left to right
    const figs = pn.characters;
    figs.forEach((name, k) => {
      const w = 0.9 / figs.length;
      items.push({ label: "character", caption: look(name), bbox: within(p, 0.05 + k * w, 0.3, 0.05 + (k + 1) * w, 0.98) });
    });
    // Balloons in the top third, above their speaker: on the speaker's side when two people share the panel
    pn.balloons.forEach((b, k) => {
      const idx = figs.indexOf(b.speaker);
      const side = figs.length > 1 && idx >= 0 ? (idx < figs.length / 2 ? "left" : "right") : pn.balloons.length > 1 ? (k === 0 ? "left" : "right") : "centre";
      const sameSide = pn.balloons.length > 1 && k === 1 && side !== "centre" &&
        (figs.length > 1 && figs.indexOf(pn.balloons[0].speaker) >= 0 ? (figs.indexOf(pn.balloons[0].speaker) < figs.length / 2 ? "left" : "right") : "left") === side;
      const [y1, y2] = sameSide ? [0.22, 0.4] : k === 0 ? [0.03, 0.24] : [0.12, 0.33];
      const box = side === "left" ? within(p, 0.03, y1, 0.55, y2) : side === "right" ? within(p, 0.45, y1, 0.97, y2) : within(p, 0.04, 0.04, 0.66, 0.27);
      const tail = side === "left" ? "down and to the left" : side === "right" ? "down and to the right" : "down";
      items.push({ label: "text", caption: `White oval speech balloon with its tail pointing ${tail} to ${short(b.speaker)}, black hand-lettered comic font.`, text: wrap(b.text, box[2] - box[0]), bbox: box });
    });
    if (pn.caption) {
      const box = within(p, 0.03, 0.84, 0.72, 0.97);
      items.push({ label: "text", caption: "Cream rectangular narration box with a thin black outline, black hand-lettered comic font.", text: wrap(pn.caption, box[2] - box[0]), bbox: box });
    }
  });
  return { width: page.width, height: page.height, bbox_coord_space: "abs", bbox_format: "xyxy", summary: { meta: ["comic page", "graphic novel"], canvas: "multi_panel", caption }, items };
}

/**
 * The Layout as MOSS-Image reads it: one line of JSON, boxes moved to the page
 * centre in yxyx order (fractional edges enclosed: left/top floored, right/bottom
 * ceiled), no width or height. Throws on a box outside the page, as the official
 * compiler does, rather than clipping it.
 */
export function compileLayout(d: LayoutDraft): string {
  const { width: W, height: H } = d;
  if (W % 16 || H % 16 || W <= 0 || H <= 0) throw new Error("width and height must be positive multiples of 16");
  const items = d.items.map((it, i) => {
    const [x1, y1, x2, y2] = it.bbox;
    if (!(x1 >= 0 && y1 >= 0 && x2 <= W && y2 <= H && x1 < x2 && y1 < y2)) throw new Error(`items[${i}].bbox is outside the ${W}x${H} page`);
    const bbox = [Math.floor(y1) - H / 2, Math.floor(x1) - W / 2, Math.ceil(y2) - H / 2, Math.ceil(x2) - W / 2];
    return { label: it.label, caption: it.caption, bbox, ...(it.text !== undefined ? { text: it.text } : {}) };
  });
  return JSON.stringify({ summary: d.summary, items, bbox_coord_space: "abs_centralized", bbox_format: "yxyx" });
}

/** MOSS-Image's own negative for pages (its photo workflow's default refuses "cartoon, illustration, text") */
export const COMIC_NEGATIVE = "worst quality, bad anatomy, watermark, jpeg artifact, blurry text, misspelled words, extra text";

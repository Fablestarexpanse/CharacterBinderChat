// ─── Character export ─────────────────────────────────────────────────────────
// Browser-side: turns a Character into a downloadable PNG card or JSON file. The
// pure parts (card shape, PNG bytes) are in tavern.ts and png.ts; this adds the
// image handling and the download, which need a DOM.

import type { Character, Lorebook, Persona, Scenario } from "@/lib/types";
import { BLANK_PNG, encodeCardPng, isPng, withTextChunk } from "./png";
import { BUNDLE_KEY, MAX_BUNDLE_OPENERS, MAX_BUNDLE_REFERENCES, bundleImage, bundleJson, type BundleImage } from "./bundle";
import { drawCardFace } from "./tradingCard";
import { characterToCard, loreToCharacterBook, lorebookToCard, personaToCard, scenarioToCard } from "./tavern";
import { PLATFORMS, type PlatformId } from "./platforms";
import { convertCardTo, lossyFields } from "./convert";
import { validateTavernCardV2 } from "./validate";
import { buildArchive, type ArchiveItem } from "./archive";

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Re-encode any browser-decodable image as PNG: metadata chunks only exist in PNGs. */
function toPngBytes(src: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas is not available"));
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error("Could not convert the image to PNG"));
        blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
      }, "image/png");
    };
    img.onerror = () => reject(new Error("Could not read the image"));
    img.src = src;
  });
}

/**
 * The image the card rides in. A data: avatar is used (re-encoded if it is not
 * already PNG); anything else — no avatar, or a URL we cannot read here — falls
 * back to a blank 1×1 PNG, and `usedAvatar` says so, so the caller can tell the
 * user their art did not make it in rather than silently exporting without it.
 */
async function carrier(avatar: string | undefined): Promise<{ bytes: Uint8Array; usedAvatar: boolean }> {
  if (avatar?.startsWith("/api/assets/")) {
    // The original upload, at full resolution (no ?w=)
    const res = await fetch(avatar.split("?")[0]);
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (isPng(bytes)) return { bytes, usedAvatar: true };
      const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
      try { return { bytes: await toPngBytes(url), usedAvatar: true }; } finally { URL.revokeObjectURL(url); }
    }
  } else if (avatar?.startsWith("data:image/png")) {
    const bytes = base64ToBytes(avatar.split(",")[1] ?? "");
    if (isPng(bytes)) return { bytes, usedAvatar: true };
  } else if (avatar?.startsWith("data:image/")) {
    return { bytes: await toPngBytes(avatar), usedAvatar: true };
  }
  return { bytes: BLANK_PNG, usedAvatar: false };
}

const safeName = (n: string) => n.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "character";

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface ExportOptions {
  format: "png" | "json";
  /** Lorebook to embed as the card's character_book */
  book?: Lorebook;
  /** Which site's format to write. Default SillyTavern, the full V2 card. */
  platform?: PlatformId;
}

/** A card file built but not yet saved: what a single export downloads and an archive holds. */
export interface CardFile {
  bytes: Uint8Array;
  ext: "png" | "json";
  /** Whether the card's own art made it in (always true for JSON) */
  usedAvatar: boolean;
}

/** Build one file: JSON as-is, or the same JSON embedded in a PNG under `key`. */
async function build(payload: unknown, key: string, avatar: string | undefined, format: "png" | "json"): Promise<CardFile> {
  if (format === "json") {
    return { bytes: new TextEncoder().encode(JSON.stringify(payload, null, 2)), ext: "json", usedAvatar: true };
  }
  const { bytes, usedAvatar } = await carrier(avatar);
  return { bytes: encodeCardPng(bytes, JSON.stringify(payload), key), ext: "png", usedAvatar };
}

function save(file: CardFile, baseName: string): void {
  download(new Blob([file.bytes as BlobPart], { type: file.ext === "png" ? "image/png" : "application/json" }), `${safeName(baseName)}.${file.ext}`);
}

export interface CharacterExportResult {
  /** Whether the character's own art made it into the file (always true for JSON) */
  usedAvatar: boolean;
  /** Labels of fields this character has content in that the chosen platform will drop or only partly keep */
  lossy: string[];
}

/**
 * A character's card file for a platform. Refuses a card the spec would reject (no
 * name or description) with the reason, and reports which of the character's own
 * fields the platform will drop, so the caller can say so before it is a surprise.
 */
export async function buildCharacterFile(
  character: Character, { format, book, platform = "sillytavern" }: ExportOptions,
): Promise<CardFile & { lossy: string[] }> {
  const card = characterToCard(
    character,
    book ? loreToCharacterBook(book.name, book.description, book.entries) : undefined,
  );
  const check = validateTavernCardV2(card);
  if (!check.valid) throw new Error(check.errors.join("; "));
  const file = await build(convertCardTo(card, platform), PLATFORMS[platform].metadataKey, character.avatar, format);
  return { ...file, lossy: lossyFields(card, platform) };
}

export async function exportCharacter(character: Character, options: ExportOptions): Promise<CharacterExportResult> {
  const file = await buildCharacterFile(character, options);
  save(file, character.name);
  return { usedAvatar: file.usedAvatar, lossy: file.lossy };
}

export const buildLorebookFile = (book: Lorebook, format: "png" | "json") => build(lorebookToCard(book), "lorebook", undefined, format);
export const buildPersonaFile = (persona: Persona, format: "png" | "json") => build(personaToCard(persona), "persona", persona.avatar, format);
export const buildScenarioFile = (scenario: Scenario, format: "png" | "json") => build(scenarioToCard(scenario), "scenario", undefined, format);

export const exportLorebook = async (book: Lorebook, format: "png" | "json") => { const f = await buildLorebookFile(book, format); save(f, book.name); return f; };
export const exportPersona = async (persona: Persona, format: "png" | "json") => { const f = await buildPersonaFile(persona, format); save(f, persona.name); return f; };
export const exportScenario = async (scenario: Scenario, format: "png" | "json") => { const f = await buildScenarioFile(scenario, format); save(f, scenario.name); return f; };

export interface LibrarySelection {
  characters: Character[];
  personas: Persona[];
  lorebooks: Lorebook[];
  scenarios: Scenario[];
}

/**
 * Download cards as one archive (CharacterBinder's layout, which this app's own
 * import reads back). Characters and personas with art go in as PNG cards so the art
 * travels; everything else as JSON. A character that fails the spec is skipped and
 * named in `skipped` rather than failing the whole archive.
 */
export async function exportArchive(sel: LibrarySelection, allLorebooks: Lorebook[]): Promise<{ count: number; skipped: string[] }> {
  const items: ArchiveItem[] = [];
  const skipped: string[] = [];
  for (const c of sel.characters) {
    try {
      const book = allLorebooks.find((b) => b.id === c.lorebookId);
      const f = await buildCharacterFile(c, { format: c.avatar ? "png" : "json", book });
      items.push({ id: c.id, kind: "character", name: c.name, tags: c.tags, createdAt: c.createdAt, updatedAt: c.updatedAt, bytes: f.bytes, ext: f.ext });
    } catch (e) {
      skipped.push(`${c.name} (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  for (const p of sel.personas) {
    const f = await buildPersonaFile(p, p.avatar ? "png" : "json");
    items.push({ id: p.id, kind: "persona", name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, bytes: f.bytes, ext: f.ext });
  }
  for (const b of sel.lorebooks) {
    const f = await buildLorebookFile(b, "json");
    items.push({ id: b.id, kind: "lorebook", name: b.name, createdAt: b.createdAt, bytes: f.bytes, ext: f.ext });
  }
  for (const sc of sel.scenarios) {
    const f = await buildScenarioFile(sc, "json");
    items.push({ id: sc.id, kind: "scenario", name: sc.name, createdAt: sc.createdAt, updatedAt: sc.updatedAt, bytes: f.bytes, ext: f.ext });
  }
  const zip = buildArchive(items);
  download(new Blob([zip as BlobPart], { type: "application/zip" }), `FableChat_Library_${new Date().toISOString().slice(0, 10)}.zip`);
  return { count: items.length, skipped };
}

// ─── Trading card ─────────────────────────────────────────────────────────────
// The same full SillyTavern V2 card, carried by a drawn card face instead of the
// bare portrait, plus FableChat's bundle (lib/cards/bundle.ts): the plain
// portrait, reference pictures and chosen first messages.

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url.startsWith("/api/assets/") ? url.split("?")[0] : url);
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch { return null; }
}

function loadImage(bytes: Uint8Array): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
    const img = new Image();
    img.onload = () => { resolve(img); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

async function avatarBytes(avatar: string | undefined): Promise<Uint8Array | null> {
  if (!avatar) return null;
  if (avatar.startsWith("data:image/")) return base64ToBytes(avatar.split(",")[1] ?? "");
  return fetchBytes(avatar);
}

export interface TradingCardOptions {
  book?: Lorebook;
  /** Saved first messages to carry; openers are not tied to a character, so the exporter picks */
  openers?: Array<{ name: string; text: string }>;
  /** Carry the reference pictures (default true) */
  references?: boolean;
}

export interface TradingCardFile {
  bytes: Uint8Array;
  usedAvatar: boolean;
  references: number;
  /** Reference pictures that could not be read or are not images we carry */
  referencesSkipped: number;
  openers: number;
}

/** The drawn face alone, for a preview. */
export async function drawTradingCardFace(character: Character): Promise<Uint8Array> {
  const bytes = await avatarBytes(character.avatar);
  const img = bytes ? await loadImage(bytes) : null;
  return drawCardFace(character, img);
}

export async function buildTradingCard(character: Character, opts: TradingCardOptions = {}): Promise<TradingCardFile> {
  const card = characterToCard(
    character,
    opts.book ? loreToCharacterBook(opts.book.name, opts.book.description, opts.book.entries) : undefined,
  );
  const check = validateTavernCardV2(card);
  if (!check.valid) throw new Error(check.errors.join("; "));

  const portraitBytes = await avatarBytes(character.avatar);
  const portraitImg = portraitBytes ? await loadImage(portraitBytes) : null;
  const face = await drawCardFace(character, portraitImg);
  let out = encodeCardPng(face, JSON.stringify(convertCardTo(card, "sillytavern")), PLATFORMS.sillytavern.metadataKey);

  const portrait = portraitBytes && portraitImg ? bundleImage(portraitBytes) ?? undefined : undefined;
  const references: BundleImage[] = [];
  let referencesSkipped = 0;
  if (opts.references !== false) {
    for (const url of (character.referenceImages ?? []).slice(0, MAX_BUNDLE_REFERENCES)) {
      const b = await fetchBytes(url);
      const img = b ? bundleImage(b) : null;
      if (img) references.push(img); else referencesSkipped++;
    }
    referencesSkipped += Math.max(0, (character.referenceImages?.length ?? 0) - MAX_BUNDLE_REFERENCES);
  }
  const openers = (opts.openers ?? []).filter((o) => o.text.trim()).slice(0, MAX_BUNDLE_OPENERS);
  const json = bundleJson({ portrait, references: references.length ? references : undefined, openers: openers.length ? openers : undefined });
  if (json) out = withTextChunk(out, BUNDLE_KEY, json);
  return { bytes: out, usedAvatar: !!portrait, references: references.length, referencesSkipped, openers: openers.length };
}

export async function exportTradingCard(character: Character, opts: TradingCardOptions = {}): Promise<TradingCardFile> {
  const file = await buildTradingCard(character, opts);
  download(new Blob([file.bytes as BlobPart], { type: "image/png" }), `${safeName(character.name)}.card.png`);
  return file;
}

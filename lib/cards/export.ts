// ─── Character export ─────────────────────────────────────────────────────────
// Browser-side: turns a Character into a downloadable PNG card or JSON file. The
// pure parts (card shape, PNG bytes) are in tavern.ts and png.ts; this adds the
// image handling and the download, which need a DOM.

import type { Character, Lorebook, Persona, Scenario } from "@/lib/types";
import { BLANK_PNG, encodeCardPng, isPng } from "./png";
import { characterToCard, loreToCharacterBook, lorebookToCard, personaToCard, scenarioToCard } from "./tavern";
import { PLATFORMS, type PlatformId } from "./platforms";
import { convertCardTo, lossyFields } from "./convert";
import { validateTavernCardV2 } from "./validate";

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

/** One file out: JSON as-is, or the same JSON embedded in a PNG under `key`. */
async function emit(
  payload: unknown, key: string, baseName: string, avatar: string | undefined, format: "png" | "json",
): Promise<{ usedAvatar: boolean }> {
  const base = safeName(baseName);
  if (format === "json") {
    download(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `${base}.json`);
    return { usedAvatar: true };
  }
  const { bytes, usedAvatar } = await carrier(avatar);
  const png = encodeCardPng(bytes, JSON.stringify(payload), key);
  download(new Blob([png as BlobPart], { type: "image/png" }), `${base}.png`);
  return { usedAvatar };
}

export interface CharacterExportResult {
  /** Whether the character's own art made it into the file (always true for JSON) */
  usedAvatar: boolean;
  /** Labels of fields this character has content in that the chosen platform will drop or only partly keep */
  lossy: string[];
}

/**
 * Export a character for a platform. Refuses a card the spec would reject (no
 * name or description) with the reason, and reports which of the character's own
 * fields the platform will drop, so the caller can say so before it is a surprise.
 */
export async function exportCharacter(
  character: Character, { format, book, platform = "sillytavern" }: ExportOptions,
): Promise<CharacterExportResult> {
  const card = characterToCard(
    character,
    book ? loreToCharacterBook(book.name, book.description, book.entries) : undefined,
  );
  const check = validateTavernCardV2(card);
  if (!check.valid) throw new Error(check.errors.join("; "));

  const lossy = lossyFields(card, platform);

  const converted = convertCardTo(card, platform);
  const { usedAvatar } = await emit(converted, PLATFORMS[platform].metadataKey, character.name, character.avatar, format);
  return { usedAvatar, lossy };
}

export const exportLorebook = (book: Lorebook, format: "png" | "json") =>
  emit(lorebookToCard(book), "lorebook", book.name, undefined, format);

export const exportPersona = (persona: Persona, format: "png" | "json") =>
  emit(personaToCard(persona), "persona", persona.name, persona.avatar, format);

export const exportScenario = (scenario: Scenario, format: "png" | "json") =>
  emit(scenarioToCard(scenario), "scenario", scenario.name, undefined, format);

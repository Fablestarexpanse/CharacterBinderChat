// ─── Character export ─────────────────────────────────────────────────────────
// Browser-side: turns a Character into a downloadable PNG card or JSON file. The
// pure parts (card shape, PNG bytes) are in tavern.ts and png.ts; this adds the
// image handling and the download, which need a DOM.

import type { Character, Lorebook } from "@/lib/types";
import { BLANK_PNG, encodeCardPng, isPng } from "./png";
import { characterToCard, loreToCharacterBook } from "./tavern";

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Re-encode any browser-decodable image as PNG: metadata chunks only exist in PNGs. */
function toPngBytes(dataUrl: string): Promise<Uint8Array> {
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
    img.src = dataUrl;
  });
}

/**
 * The image the card rides in. A data: avatar is used (re-encoded if it is not
 * already PNG); anything else — no avatar, or a URL we cannot read here — falls
 * back to a blank 1×1 PNG, and `usedAvatar` says so, so the caller can tell the
 * user their art did not make it in rather than silently exporting without it.
 */
async function carrier(avatar: string | undefined): Promise<{ bytes: Uint8Array; usedAvatar: boolean }> {
  if (avatar?.startsWith("data:image/png")) {
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
}

/** Returns whether the character's own art made it into the file (always true for JSON). */
export async function exportCharacter(character: Character, { format, book }: ExportOptions): Promise<{ usedAvatar: boolean }> {
  const card = characterToCard(
    character,
    book ? loreToCharacterBook(book.name, book.description, book.entries) : undefined,
  );
  const json = JSON.stringify(card, null, format === "json" ? 2 : 0);
  const base = safeName(character.name);

  if (format === "json") {
    download(new Blob([json], { type: "application/json" }), `${base}.json`);
    return { usedAvatar: true };
  }
  const { bytes, usedAvatar } = await carrier(character.avatar);
  // "chara" is the keyword SillyTavern, Chub and most platforms read
  const png = encodeCardPng(bytes, json, "chara");
  download(new Blob([png as BlobPart], { type: "image/png" }), `${base}.png`);
  return { usedAvatar };
}

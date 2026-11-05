// ─── Images, client side ──────────────────────────────────────────────────────
// Upload an image to the asset store and get back the /api/assets/<hash> URL to put
// in a row, and ask for a size-appropriate copy when displaying one. Client-safe.

import { downscaleImage } from "@/lib/image/downscale";

export const isAssetUrl = (src: string | undefined): src is string => !!src && src.startsWith("/api/assets/");

/**
 * The URL to display `src` at about `px` CSS pixels. Asset URLs get a resized copy
 * at twice that (sharp on high-density screens); anything else (a pasted URL, an
 * older inline image) is returned unchanged.
 */
export function sizedSrc(src: string | undefined, px: number): string | undefined {
  if (!isAssetUrl(src) || src.includes("?")) return src;
  return `${src}?w=${Math.ceil(px * 2)}`;
}

/** Upload an image's original bytes. Resolves to its asset URL; rejects with the server's reason. */
export async function uploadImage(image: Blob): Promise<string> {
  const res = await fetch("/api/assets", { method: "POST", body: image });
  const body = await res.json().catch(() => null) as { ok?: boolean; url?: string; error?: string } | null;
  if (!res.ok || !body?.ok || !body.url) throw new Error(body?.error ?? `upload failed (HTTP ${res.status})`);
  return body.url;
}

/**
 * An avatar for this image: the original, stored as an asset. If the upload fails
 * (the server is unreachable) it falls back to the old inline 512 px copy, so picking
 * an avatar still works; the server moves inline images into the asset store the
 * next time it starts.
 */
export async function imageToAvatar(image: Blob): Promise<string | null> {
  try {
    return await uploadImage(image);
  } catch (e) {
    console.warn("[assets] upload failed, keeping the image inline for now:", e instanceof Error ? e.message : e);
    return downscaleImage(image);
  }
}

/**
 * Store a picture shown anywhere in the app (a ComfyUI result through the
 * proxy, a gallery image) as an asset, so it can be kept as a reference. The
 * same picture always lands on the same asset (content-addressed).
 */
export async function storePicture(url: string): Promise<string> {
  if (isAssetUrl(url)) return url.split("?")[0];
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not read that picture (HTTP ${res.status}).`);
  return uploadImage(await res.blob());
}

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

/** Made in a chat: also save a copy to the folder in Settings → Media (when one is set), named for this character. */
export interface CopyFor { who: string }

const assetQuery = (video: boolean, copy?: CopyFor) => {
  const q = new URLSearchParams();
  if (video) q.set("kind", "video");
  if (copy) { q.set("copy", "1"); q.set("who", copy.who); }
  const s = q.toString();
  return s ? `/api/assets?${s}` : "/api/assets";
};

async function upload(blob: Blob, video: boolean, copy?: CopyFor): Promise<string> {
  const res = await fetch(assetQuery(video, copy), { method: "POST", body: blob });
  const body = await res.json().catch(() => null) as { ok?: boolean; url?: string; error?: string; saveError?: string } | null;
  if (!res.ok || !body?.ok || !body.url) throw new Error(body?.error ?? `upload failed (HTTP ${res.status})`);
  // The copy is extra: the picture is stored either way, so a full disk is a warning, not a failure
  if (body.saveError) console.warn("[media] " + body.saveError);
  return body.url;
}

/** Upload an image's original bytes. Resolves to its asset URL; rejects with the server's reason. */
export const uploadImage = (image: Blob, copy?: CopyFor): Promise<string> => upload(image, false, copy);

/** Upload a clip (MP4 or WebM) to the asset store. Resolves to its asset URL. */
export const uploadVideo = (clip: Blob, copy?: CopyFor): Promise<string> => upload(clip, true, copy);

/** Store a clip ComfyUI made (through the proxy) as an asset. */
export async function storeClip(url: string, copy?: CopyFor): Promise<string> {
  if (isAssetUrl(url)) return url.split("?")[0];
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not read that clip (HTTP ${res.status}).`);
  return uploadVideo(await res.blob(), copy);
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
export async function storePicture(url: string, copy?: CopyFor): Promise<string> {
  if (isAssetUrl(url)) return url.split("?")[0];
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not read that picture (HTTP ${res.status}).`);
  return uploadImage(await res.blob(), copy);
}

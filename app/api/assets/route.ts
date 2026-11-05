import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { routeError, badRequest, guard } from "@/lib/api/server";
import { assetUrl } from "@/lib/db/assets";
import { readBodyCapped, MAX_UPLOAD_BYTES, MAX_VIDEO_BYTES } from "@/lib/server/assets";
import { saveCopy } from "@/lib/server/mediaFolder";

export const dynamic = "force-dynamic";

// ─── POST /api/assets ─────────────────────────────────────────────────────────
// Body: the image bytes (PNG, JPEG, GIF or WebP; checked from the bytes, not the
// header). → { ok, hash, url }. The same image uploaded twice is stored once.
// Put the returned url in a row (an avatar); an upload nothing references is
// swept after a day. `?kind=video` also accepts a clip (MP4 or WebM, a larger
// limit): only the clip path asks, so an avatar upload can never be a movie.
// `?copy=1&who=<character>` (photos and clips made in chats) also writes a copy
// to the folder chosen in Settings → Media, when one is set; the reply then
// carries `savedTo` or `saveError`, and the asset is stored either way.

export async function POST(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const video = req.nextUrl.searchParams.get("kind") === "video";
    let bytes: Uint8Array;
    try { bytes = await readBodyCapped(req, video ? MAX_VIDEO_BYTES : MAX_UPLOAD_BYTES); }
    catch (e) { return badRequest(e instanceof Error ? e.message : "the upload failed"); }
    if (bytes.length === 0) return badRequest("send the image as the request body");
    try {
      const { hash, mime, size } = getStore().putAsset(bytes, { video });
      const params = req.nextUrl.searchParams;
      const copy = params.get("copy") === "1" ? await saveCopy(bytes, mime, hash, { who: params.get("who") ?? undefined }) : null;
      return Response.json({ ok: true, hash, url: assetUrl(hash), mime, size, ...(copy ?? {}) });
    } catch (e) {
      return badRequest(e instanceof Error ? e.message : String(e));
    }
  } catch (err) {
    return routeError("[assets POST]", err);
  }
}

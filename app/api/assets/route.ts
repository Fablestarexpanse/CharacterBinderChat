import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { routeError, badRequest, guard } from "@/lib/api/server";
import { assetUrl } from "@/lib/db/assets";
import { readBodyCapped, MAX_UPLOAD_BYTES } from "@/lib/server/assets";

export const dynamic = "force-dynamic";

// ─── POST /api/assets ─────────────────────────────────────────────────────────
// Body: the image bytes (PNG, JPEG, GIF or WebP; checked from the bytes, not the
// header). → { ok, hash, url }. The same image uploaded twice is stored once.
// Put the returned url in a row (an avatar); an upload nothing references is
// swept after a day.

export async function POST(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    let bytes: Uint8Array;
    try { bytes = await readBodyCapped(req, MAX_UPLOAD_BYTES); }
    catch (e) { return badRequest(e instanceof Error ? e.message : "the upload failed"); }
    if (bytes.length === 0) return badRequest("send the image as the request body");
    try {
      const { hash, mime, size } = getStore().putAsset(bytes);
      return Response.json({ ok: true, hash, url: assetUrl(hash), mime, size });
    } catch (e) {
      return badRequest(e instanceof Error ? e.message : String(e));
    }
  } catch (err) {
    return routeError("[assets POST]", err);
  }
}

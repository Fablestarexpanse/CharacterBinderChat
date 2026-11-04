import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { routeError, guard } from "@/lib/api/server";
import { resized, snapWidth } from "@/lib/server/assets";

export const dynamic = "force-dynamic";

// ─── GET /api/assets/<hash>?w=<pixels> ────────────────────────────────────────
// The image. With ?w= a resized WebP copy (snapped to 64/128/256/512/1024), or the
// original when resizing is unavailable. Content-addressed, so cached forever.

const SAFE_HEADERS = {
  "Cache-Control": "public, max-age=31536000, immutable",
  // Served as an image and nothing else, even if someone manages to store odd bytes
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ hash: string }> }) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const { hash } = await params;
    const asset = getStore().getAsset(hash);
    if (!asset) return Response.json({ ok: false, error: "no such image" }, { status: 404 });

    const w = snapWidth(Number(req.nextUrl.searchParams.get("w")));
    if (w !== null) {
      const small = await resized(hash, asset.bytes, w);
      if (small) return new Response(new Uint8Array(small), { headers: { ...SAFE_HEADERS, "Content-Type": "image/webp" } });
    }
    return new Response(new Uint8Array(asset.bytes), { headers: { ...SAFE_HEADERS, "Content-Type": asset.mime } });
  } catch (err) {
    return routeError("[assets/hash GET]", err);
  }
}

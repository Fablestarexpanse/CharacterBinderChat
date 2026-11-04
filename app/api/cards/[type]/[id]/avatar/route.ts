import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { routeError, badRequest, guard } from "@/lib/api/server";
import { isCardType, setAvatar, cleanSource, CardError, CARD_TYPES } from "@/lib/server/cards";
import { readBodyCapped, MAX_UPLOAD_BYTES } from "@/lib/server/assets";

export const dynamic = "force-dynamic";

// PUT /api/cards/<character|persona>/<id>/avatar   body: the image bytes
// Sets the picture. Recorded and undoable like every other outside change.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const { type, id } = await params;
    if (!isCardType(type)) return badRequest(`type must be one of: ${CARD_TYPES.join(", ")}`);
    let bytes: Uint8Array;
    try { bytes = await readBodyCapped(req, MAX_UPLOAD_BYTES); }
    catch (e) { return badRequest(e instanceof Error ? e.message : "the upload failed"); }
    if (bytes.length === 0) return badRequest("send the image as the request body");
    return Response.json({ ok: true, ...setAvatar(getStore(), type, id, bytes, cleanSource(req.headers.get("x-fable-source"))) });
  } catch (err) {
    if (err instanceof CardError) return Response.json({ ok: false, error: err.message }, { status: err.status });
    return routeError("[cards/avatar PUT]", err);
  }
}

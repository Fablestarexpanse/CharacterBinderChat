import { NextRequest } from "next/server";
import { routeError, badRequest, guard } from "@/lib/api/server";
import { getMediaFolder, setMediaFolder } from "@/lib/server/mediaFolder";

export const dynamic = "force-dynamic";

// ─── /api/media/save-folder ───────────────────────────────────────────────────
// GET → { folder, byCharacter }: where copies of chat photos and clips go.
// PUT { folder?: string | null, byCharacter?: boolean } → the folder is checked
// (absolute, created if missing, writable) before it is kept; null turns copies
// off. → { ok, settings } or 400 { ok: false, error }.

export async function GET(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    return Response.json(getMediaFolder());
  } catch (err) {
    return routeError("[media/save-folder GET]", err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const body = (await req.json()) as { folder?: unknown; byCharacter?: unknown };
    if (body.folder !== undefined && body.folder !== null && typeof body.folder !== "string") return badRequest("folder must be a path or null");
    if (body.byCharacter !== undefined && typeof body.byCharacter !== "boolean") return badRequest("byCharacter must be true or false");
    const r = await setMediaFolder({ folder: body.folder as string | null | undefined, byCharacter: body.byCharacter as boolean | undefined });
    return r.ok ? Response.json({ ok: true, settings: r.settings }) : badRequest(r.error);
  } catch (err) {
    return routeError("[media/save-folder PUT]", err);
  }
}

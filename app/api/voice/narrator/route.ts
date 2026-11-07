import { NextRequest } from "next/server";
import { routeError, badRequest, guard } from "@/lib/api/server";
import { readJsonCapped } from "@/lib/server/assets";
import { getNarrator, setNarrator } from "@/lib/server/narrator";

export const dynamic = "force-dynamic";

// GET → { enabled, voice? }   PUT { enabled?, voice? } → { ok: true, enabled, voice? }
// The narrator reads a story reply's narration while the character speaks their
// quoted lines. Turning it on needs a voice; without one it stays off.
export async function GET(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    return Response.json(getNarrator());
  } catch (err) {
    return routeError("[voice/narrator GET]", err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const body = await readJsonCapped(req, 16 * 1024, "the request").catch(() => null);
    if (!body || typeof body !== "object") return badRequest("the body must be a JSON object");
    return Response.json({ ok: true, ...setNarrator(body) });
  } catch (err) {
    return routeError("[voice/narrator PUT]", err);
  }
}

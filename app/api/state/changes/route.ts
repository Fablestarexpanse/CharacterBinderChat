import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { routeError, badRequest } from "@/lib/api/server";

export const dynamic = "force-dynamic";

// ─── GET /api/state/changes?since=<rev> ───────────────────────────────────────
// Everything written or deleted after revision `since`, plus announcements for
// writes made by something other than the browser. A tab polls this to pick up
// what an agent (or another device) did. Cheap when nothing changed: the
// response is just the revision and empty lists.

export async function GET(req: NextRequest) {
  try {
    const raw = req.nextUrl.searchParams.get("since");
    const since = raw === null ? NaN : Number(raw);
    if (!Number.isInteger(since) || since < 0) return badRequest("since must be a non-negative integer revision");
    return Response.json(getStore().getChangesSince(since));
  } catch (err) {
    return routeError("[state/changes GET]", err);
  }
}

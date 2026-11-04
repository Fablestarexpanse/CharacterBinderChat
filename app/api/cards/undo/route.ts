import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { routeError, badRequest, guard } from "@/lib/api/server";
import { undo, cleanSource, CardError } from "@/lib/server/cards";

export const dynamic = "force-dynamic";

// POST /api/cards/undo   body: { historyId }
// Reverse a change an outside writer made. The id comes from the write's response
// or from the event the tab shows.
export async function POST(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const body = await req.json().catch(() => null) as { historyId?: unknown } | null;
    if (!body || !Number.isInteger(body.historyId)) return badRequest("historyId (an integer) is required");
    return Response.json({ ok: true, ...undo(getStore(), body.historyId as number, cleanSource(req.headers.get("x-fable-source") ?? "user")) });
  } catch (err) {
    if (err instanceof CardError) return Response.json({ ok: false, error: err.message }, { status: err.status });
    return routeError("[cards/undo POST]", err);
  }
}

import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { routeError, badRequest, guard } from "@/lib/api/server";
import { isCardType, createCard, cleanSource, CardError, CARD_TYPES } from "@/lib/server/cards";

export const dynamic = "force-dynamic";

// POST /api/cards/<type>   body: { card: {...} }
// Create a card from its interchange format (Tavern V2, lorebook, persona,
// scenario). A bare set of character fields is accepted for a character. Written
// to the server; open tabs pick it up on their next poll.
export async function POST(req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const { type } = await params;
    if (!isCardType(type)) return badRequest(`type must be one of: ${CARD_TYPES.join(", ")}`);
    const body = await req.json().catch(() => null) as { card?: unknown } | null;
    if (!body || body.card === undefined) return badRequest("body must be { card: {...} }");
    const created = createCard(getStore(), type, body.card, cleanSource(req.headers.get("x-fable-source")));
    return Response.json({ ok: true, ...created });
  } catch (err) {
    if (err instanceof CardError) return Response.json({ ok: false, error: err.message }, { status: err.status });
    return routeError("[cards POST]", err);
  }
}

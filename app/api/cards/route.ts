import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { routeError, badRequest, guard } from "@/lib/api/server";
import { isCardType, listCards, CARD_TYPES } from "@/lib/server/cards";

export const dynamic = "force-dynamic";

// GET /api/cards?type=character|lorebook|persona|scenario
// A short summary of every card of that type. Cards themselves are read one at a
// time from /api/cards/<type>/<id>.
export async function GET(req: NextRequest) {
  try {
    const denied = guard(req);
    if (denied) return denied;
    const type = req.nextUrl.searchParams.get("type");
    if (!isCardType(type)) return badRequest(`type must be one of: ${CARD_TYPES.join(", ")}`);
    return Response.json({ cards: listCards(getStore(), type) });
  } catch (err) {
    return routeError("[cards GET]", err);
  }
}

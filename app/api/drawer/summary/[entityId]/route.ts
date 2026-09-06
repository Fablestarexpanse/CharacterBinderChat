import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { routeError, badRequest } from "@/lib/api/server";

export const dynamic = "force-dynamic";

// GET /api/drawer/summary/<entityId>?chatId=<chatId>
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  try {
    const { entityId } = await params;
    const chatId = req.nextUrl.searchParams.get("chatId");
    if (!chatId) {
      return badRequest("chatId param required");
    }
    const store   = getStore();
    const summary = store.getCharacterSummary(chatId, entityId);
    return Response.json(summary);
  } catch (err) {
    return routeError("[drawer/summary/[entityId] GET]", err);
  }
}

import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { routeError } from "@/lib/api";

export const dynamic = "force-dynamic";

// GET /api/drawer/summary/<entityId>?chat=<chatId>
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  try {
    const { entityId } = await params;
    const chatId = req.nextUrl.searchParams.get("chat");
    if (!chatId) {
      return Response.json({ error: "chat param required" }, { status: 400 });
    }
    const store   = getStore();
    const summary = store.characterSummary(chatId, entityId);
    return Response.json(summary);
  } catch (err) {
    return routeError("[drawer/summary/[entityId] GET]", err);
  }
}

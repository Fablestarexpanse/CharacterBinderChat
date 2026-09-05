import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { routeError } from "@/lib/api";

export const dynamic = "force-dynamic";

// POST /api/drawer/entities/merge
// Body: { fromId: string, toId: string }
// Rewrites all facts/stats/commitments from fromId → toId, then deletes fromId.
// This is intentionally destructive and irreversible — caller must confirm before invoking.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { chatId?: string; fromId?: string; toId?: string };
    const { chatId, fromId, toId } = body;

    if (!chatId || !fromId || !toId) {
      return Response.json({ ok: false, error: "chatId, fromId and toId are required" }, { status: 400 });
    }
    if (fromId === toId) {
      return Response.json({ ok: false, error: "fromId and toId must be different" }, { status: 400 });
    }

    const store = getStore();

    // Verify both entities exist before merging
    if (!store.getEntity(chatId, fromId)) {
      return Response.json({ ok: false, error: `Entity not found: ${fromId}` }, { status: 404 });
    }
    if (!store.getEntity(chatId, toId)) {
      return Response.json({ ok: false, error: `Entity not found: ${toId}` }, { status: 404 });
    }

    store.mergeEntity(chatId, fromId, toId);

    return Response.json({ ok: true, merged: { from: fromId, into: toId } });
  } catch (err) {
    return routeError("[entities/merge]", err);
  }
}

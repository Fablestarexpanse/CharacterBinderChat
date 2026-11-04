import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { routeError, badRequest } from "@/lib/api/server";

export const dynamic = "force-dynamic";

// ─── POST /api/drawer/snapshot ────────────────────────────────────────────────
// Body: { chatId, messageId }
// Records core memory + relationship stats as they stand, keyed by the message
// whose extraction just finished, so a later branch from that message can start
// from exactly this state. Called by the client once extraction completes.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { chatId?: unknown; messageId?: unknown };
    if (typeof body.chatId !== "string" || !body.chatId) return badRequest("chatId is required");
    if (typeof body.messageId !== "string" || !body.messageId) return badRequest("messageId is required");
    getStore().saveMemorySnapshot(body.chatId, body.messageId);
    return Response.json({ ok: true });
  } catch (err) {
    return routeError("[drawer/snapshot POST]", err);
  }
}

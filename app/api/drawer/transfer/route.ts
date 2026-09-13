import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { routeError, badRequest } from "@/lib/api/server";

export const dynamic = "force-dynamic";

// ─── GET /api/drawer/transfer?characterId=X ───────────────────────────────────
// Lists chats that hold memories involving this character, so the client can
// offer "continue with memories from …" when starting a new chat. Returns
// newest-first.

export async function GET(req: NextRequest) {
  try {
    const characterId = req.nextUrl.searchParams.get("characterId");
    if (!characterId) {
      return badRequest("characterId param required");
    }
    const store = getStore();
    const sources = store.listMemorySources(characterId);
    return Response.json({ sources });
  } catch (err) {
    return routeError("[drawer/transfer GET]", err);
  }
}

// ─── POST /api/drawer/transfer ────────────────────────────────────────────────
// Body: { fromChatId, toChatId }
// Copies one chat's entire memory into another. This is the ONLY way memories
// cross chats — each chat is otherwise a fresh start.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { fromChatId?: string; toChatId?: string };
    const { fromChatId, toChatId } = body;

    if (!fromChatId || !toChatId) {
      return badRequest("fromChatId and toChatId are required");
    }
    if (fromChatId === toChatId) {
      return badRequest("fromChatId and toChatId must be different");
    }

    const store  = getStore();
    const copied = store.transferMemory(fromChatId, toChatId);
    return Response.json({ ok: true, copied });
  } catch (err) {
    return routeError("[drawer/transfer POST]", err);
  }
}

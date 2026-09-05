import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { routeError } from "@/lib/api";

export const dynamic = "force-dynamic";

// ─── GET /api/drawer/transfer?characterId=X ───────────────────────────────────
// Lists chats that hold memories involving this character, so the client can
// offer "continue with memories from …" when starting a new chat. Returns
// newest-first.

export async function GET(req: NextRequest) {
  try {
    const characterId = req.nextUrl.searchParams.get("characterId");
    if (!characterId) {
      return Response.json({ error: "characterId param required" }, { status: 400 });
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
      return Response.json({ error: "fromChatId and toChatId are required" }, { status: 400 });
    }
    if (fromChatId === toChatId) {
      return Response.json({ error: "fromChatId and toChatId must be different" }, { status: 400 });
    }

    const store  = getStore();
    const copied = store.transferMemory(fromChatId, toChatId);
    return Response.json({ ok: true, copied });
  } catch (err) {
    return routeError("[drawer/transfer POST]", err);
  }
}

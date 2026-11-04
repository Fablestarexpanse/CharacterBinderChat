import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { routeError, badRequest } from "@/lib/api/server";
import type { Chat } from "@/lib/types";

export const dynamic = "force-dynamic";

// ─── POST /api/drawer/branch ──────────────────────────────────────────────────
// Body: { sourceChatId, chat, keptMessageIds, messageIdMap, fallbackCutoff }
//   chat            — the complete new chat (with its copied messages)
//   keptMessageIds  — SOURCE message ids kept in the branch, oldest first
//   messageIdMap    — source message id → its copy's id in the new chat
//   fallbackCutoff  — unix seconds, or null when branching from the latest message
//
// Creates the chat AND copies its memory-as-of-the-branch-point in one request.
// The chat row is written here rather than left to the debounced state sync:
// memory for a chat that is not in app_chats yet is exactly what
// purgeOrphanedChatMemory deletes, so a sync landing between the two would
// destroy the branch's memory.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      sourceChatId?: unknown; chat?: Partial<Chat> | null; keptMessageIds?: unknown;
      messageIdMap?: unknown; fallbackCutoff?: unknown;
    };
    const { sourceChatId, chat, keptMessageIds, messageIdMap, fallbackCutoff } = body;

    if (typeof sourceChatId !== "string" || !sourceChatId) return badRequest("sourceChatId is required");
    if (!chat || typeof chat.id !== "string" || !chat.id || !Array.isArray(chat.messages)) {
      return badRequest("chat with an id and messages is required");
    }
    if (chat.id === sourceChatId) return badRequest("a branch needs its own chat id");
    if (!Array.isArray(keptMessageIds) || keptMessageIds.some((id) => typeof id !== "string")) {
      return badRequest("keptMessageIds must be an array of strings");
    }
    if (typeof messageIdMap !== "object" || messageIdMap === null || Array.isArray(messageIdMap)) {
      return badRequest("messageIdMap must be an object");
    }
    if (fallbackCutoff !== null && typeof fallbackCutoff !== "number") {
      return badRequest("fallbackCutoff must be a number or null");
    }

    const store = getStore();
    if (store.chatExists(chat.id)) {
      return badRequest("that chat already exists");
    }
    store.patchAppState({ upserts: { chats: [chat as Chat & { id: string }] } });
    const copied = store.branchMemory({
      fromChatId: sourceChatId,
      toChatId: chat.id,
      keptMessageIds: keptMessageIds as string[],
      fallbackCutoff: fallbackCutoff as number | null,
      messageIdMap: messageIdMap as Record<string, string>,
    });
    return Response.json({ ok: true, copied });
  } catch (err) {
    return routeError("[drawer/branch POST]", err);
  }
}

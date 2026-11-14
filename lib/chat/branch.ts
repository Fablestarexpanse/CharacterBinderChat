// ─── Branch from here ─────────────────────────────────────────────────────────
// Copies a chat up to and including one message into a new chat, together with
// the memory the story had at that point (see lib/db/branch.ts for how). The
// source chat is untouched.

import { useFableStore } from "@/lib/store";
import { sendJson } from "@/lib/api/client";
import type { Chat, Message } from "@/lib/types";

export interface BranchOutcome {
  chatId: string;
  /** Memory copied from live values rather than a snapshot — see BranchMemoryResult */
  approximate: boolean;
  /** Memory could not be copied; the chat was still created */
  memoryError: string | null;
}

export async function branchChat(chatId: string, messageId: string): Promise<BranchOutcome | null> {
  const store = useFableStore.getState();
  const source = store.chats.find((c) => c.id === chatId);
  if (!source || store.isGenerating) return null;
  const at = source.messages.findIndex((m) => m.id === messageId);
  if (at === -1) return null;

  const kept = source.messages.slice(0, at + 1);
  const next = source.messages[at + 1];
  const newId = `chat-${Date.now()}`;
  const stamp = Date.now();

  const messageIdMap: Record<string, string> = {};
  const messages: Message[] = kept.map((m, i) => {
    const id = `msg-${stamp}-b${i}`;
    messageIdMap[m.id] = id;
    return { ...m, id, chatId: newId };
  });
  // Comic-it boundaries point at message ids, which a branch renames
  const remap = (id: string) => messageIdMap[id];
  for (const m of messages) {
    if (m.comic) m.comic = { ...m.comic, fromId: remap(m.comic.fromId) ?? m.comic.fromId, upToId: remap(m.comic.upToId) ?? m.comic.upToId };
  }
  const lastCard = [...messages].reverse().find((m) => m.comic);
  const branchComic = source.comic
    ? remap(source.comic.upTo)
      ? { ...source.comic, upTo: remap(source.comic.upTo) }
      // The last page ended after the branch point: continue from the last page the branch kept
      : lastCard?.comic ? { ...source.comic, upTo: lastCard.comic.upToId, recap: lastCard.comic.recap } : undefined
    : undefined;

  const nowIso = new Date().toISOString();
  const chat: Chat = {
    ...source,
    id: newId,
    name: `${source.name} (branch)`,
    messages,
    branchOf: { chatId: source.id, chatName: source.name, messageId },
    comic: branchComic,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  // Where memory ends. A later message exists → the branch is a rewind, and
  // anything ingested once that message arrived did not happen yet. No later
  // message → the branch point is the present and everything counts.
  const fallbackCutoff = next ? Math.floor(Date.parse(next.timestamp) / 1000) : null;

  let approximate = false;
  let memoryError: string | null = null;
  try {
    const res = await sendJson<{ copied: { approximate: boolean } }>("POST", "/api/drawer/branch", {
      sourceChatId: chatId,
      chat,
      keptMessageIds: kept.map((m) => m.id),
      messageIdMap,
      fallbackCutoff,
    });
    approximate = res.copied.approximate;
  } catch (e) {
    memoryError = e instanceof Error ? e.message : String(e);
    useFableStore.getState().setLastExtractionError(`branch memory could not be copied — ${memoryError}`);
  }

  useFableStore.getState().addBranchedChat(
    approximate && chat.branchOf ? { ...chat, branchOf: { ...chat.branchOf, approximateMemory: true } } : chat
  );
  return { chatId: newId, approximate, memoryError };
}

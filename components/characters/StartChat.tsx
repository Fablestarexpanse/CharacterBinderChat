"use client";

// ─── Starting a chat with a character ─────────────────────────────────────────
// Each chat is a fresh start. If earlier chats hold memories of this character,
// offer to carry one forward, explicitly (memory never carries over by itself).
// Extracted from the old Characters screen so the Library and anything else can
// start a chat the same way.

import { useState } from "react";
import { History, Sparkles } from "lucide-react";
import { useFableStore } from "@/lib/store";
import { useUiStore } from "@/lib/store/ui";
import { getJson, sendJson } from "@/lib/api/client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface MemorySource { chatId: string; chatName: string | null; facts: number; updatedAt: number }

export function useStartChat(onError: (message: string) => void) {
  const { createChat, setActiveChatId } = useFableStore();
  const { setActiveSection } = useUiStore();
  const [chooser, setChooser] = useState<{ characterId: string; sources: MemorySource[] } | null>(null);

  const begin = (characterId: string, fromChatId?: string) => {
    const chatId = createChat(characterId);
    setActiveChatId(chatId);
    setActiveSection("chats");
    setChooser(null);
    if (fromChatId) {
      sendJson("POST", "/api/drawer/transfer", { fromChatId, toChatId: chatId })
        .then(() => useFableStore.getState().bumpExtraction())
        // Said out loud: a failed transfer used to look exactly like a fresh start
        .catch((e: Error) => onError(`Carrying memories forward failed — ${e.message}`));
    }
  };

  const startChat = async (characterId: string) => {
    try {
      const data = await getJson<{ sources?: MemorySource[] }>(`/api/drawer/transfer?characterId=${encodeURIComponent(characterId)}`);
      const sources = (data.sources ?? []).filter((s) => s.facts > 0);
      if (sources.length > 0) { setChooser({ characterId, sources: sources.slice(0, 4) }); return; }
    } catch { /* offline or route error: just start fresh */ }
    begin(characterId);
  };

  const dialog = (
    <Dialog open={!!chooser} onOpenChange={(o) => { if (!o) setChooser(null); }}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <div className="border-b border-[var(--border)] px-5 py-4">
          <DialogTitle>Start a new story?</DialogTitle>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className="text-xs text-[var(--muted-fg)]">
            Each chat is its own story — the character starts with no memory of other chats. You can carry memories
            over from a previous story if you want to continue where you left off.
          </p>
          <button
            onClick={() => chooser && begin(chooser.characterId)}
            className="w-full flex items-center gap-3 rounded-xl border border-[var(--border)] p-3 text-left hover:border-[var(--purple)] hover:bg-[var(--purple-light)] transition-colors"
          >
            <Sparkles className="h-4 w-4 text-[var(--purple-fg)] flex-shrink-0" />
            <span>
              <span className="block text-sm font-medium text-[var(--foreground)]">Fresh start</span>
              <span className="block text-xs text-[var(--muted-fg)]">A blank slate — nothing remembered</span>
            </span>
          </button>
          {chooser?.sources.map((s) => (
            <button
              key={s.chatId}
              onClick={() => begin(chooser.characterId, s.chatId)}
              className="w-full flex items-center gap-3 rounded-xl border border-[var(--border)] p-3 text-left hover:border-[var(--purple)] hover:bg-[var(--purple-light)] transition-colors"
            >
              <History className="h-4 w-4 text-[var(--muted-fg)] flex-shrink-0" />
              <span>
                <span className="block text-sm font-medium text-[var(--foreground)]">Continue from “{s.chatName ?? s.chatId}”</span>
                <span className="block text-xs text-[var(--muted-fg)]">
                  Carries over {s.facts} remembered fact{s.facts !== 1 ? "s" : ""} and the relationship
                </span>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );

  return { startChat, dialog };
}

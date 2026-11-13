"use client";

// Mounts the reaching-out check (lib/outreach/runner.ts) and clears a chat's
// unread mark when you open it. Renders nothing.

import { useEffect } from "react";
import { useFableStore } from "@/lib/store";
import { useUiStore } from "@/lib/store/ui";
import { outreachTick, announce } from "@/lib/outreach/runner";
import { generateAssistantReply } from "@/lib/chat/generation";
import { contactSettings } from "@/lib/chat/photos";
import { ringIn } from "@/lib/chat/calls";

const EVERY_MS = 60_000;

export function OutreachRunner() {
  const activeChatId = useFableStore((s) => s.activeChatId);
  const section = useUiStore((s) => s.activeSection);
  const clearUnread = useUiStore((s) => s.clearUnread);

  useEffect(() => {
    let stopped = false;
    const run = () => { if (!stopped) void outreachTick().catch((e: Error) => console.warn("[outreach]", e.message)); };
    const first = setTimeout(run, 15_000);
    const every = setInterval(run, EVERY_MS);
    // Development only: run a check on demand from the console (and in browser checks)
    if (process.env.NODE_ENV !== "production") {
      const w = window as unknown as { fableOutreachTick?: typeof outreachTick; fableRingIn?: (chatId?: string) => Promise<void>; fableTextIn?: (chatId: string) => Promise<void> };
      // Deliver a text from that chat's character as reaching out does (the chime and, when you are elsewhere, the pop-up)
      w.fableTextIn = async (chatId) => {
        const st = useFableStore.getState();
        const chat = st.chats.find((c) => c.id === chatId);
        const character = st.characters.find((c) => c.id === chat?.characterId);
        if (!chat || !character) return;
        await generateAssistantReply(chat.id, character.id, { trigger: "promise", reason: "of the shuttle they promised you", silence: "3 hours" });
        const s = await contactSettings();
        announce(chat, character, s.notifications, s.sounds);
      };
      w.fableOutreachTick = outreachTick;
      // Make the open chat's character ring now, as if the rules had chosen a call (the rules themselves are unit-tested)
      w.fableRingIn = async (chatId) => {
        const st = useFableStore.getState();
        const chat = st.chats.find((c) => c.id === (chatId ?? st.activeChatId));
        if (chat?.characterId) await ringIn(chat.id, chat.characterId, { trigger: "repair", reason: "trust broke between you and they want to say something", silence: "a day" });
      };
    }
    return () => { stopped = true; clearTimeout(first); clearInterval(every); };
  }, []);

  useEffect(() => {
    if (activeChatId && (section === "chats" || section === "archive")) clearUnread(activeChatId);
  }, [activeChatId, section, clearUnread]);

  return null;
}

"use client";

// Mounts the reaching-out check (lib/outreach/runner.ts) and clears a chat's
// unread mark when you open it. Renders nothing.

import { useEffect } from "react";
import { useFableStore } from "@/lib/store";
import { useUiStore } from "@/lib/store/ui";
import { outreachTick } from "@/lib/outreach/runner";

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
    if (process.env.NODE_ENV !== "production") (window as unknown as { fableOutreachTick?: typeof outreachTick }).fableOutreachTick = outreachTick;
    return () => { stopped = true; clearTimeout(first); clearInterval(every); };
  }, []);

  useEffect(() => {
    if (activeChatId && section === "chats") clearUnread(activeChatId);
  }, [activeChatId, section, clearUnread]);

  return null;
}

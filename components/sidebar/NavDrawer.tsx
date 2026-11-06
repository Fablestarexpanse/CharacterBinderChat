"use client";

// ─── Narrow-screen navigation ─────────────────────────────────────────────────
// Below 768 px the sidebar leaves the layout: a slim bar carries a menu button,
// and the sidebar slides in over the page. The drawer is open "at" the place it
// was opened from (see navOpenAt), so choosing a section or a chat closes it.

import { useEffect } from "react";
import { Menu, Sparkles } from "lucide-react";
import { useFableStore } from "@/lib/store";
import { useUiStore } from "@/lib/store/ui";
import { Sidebar, NAV_ITEMS } from "./Sidebar";

function useNavKey(): string {
  const { activeChatId } = useFableStore();
  const { activeSection } = useUiStore();
  return `${activeSection}|${activeSection === "chats" ? activeChatId ?? "" : ""}`;
}

export function MobileBar() {
  const key = useNavKey();
  const { activeSection, setNavOpenAt } = useUiStore();
  // The section, not the chat: an open chat's header already names it
  const title = NAV_ITEMS.find((n) => n.id === activeSection)?.label ?? "FableChat";
  // The chat list is in the drawer: a dot on the menu says something came in (green and pulsing while a call rings)
  const ringing = useUiStore((s) => s.call?.phase === "incoming");
  // Counted over chats that still exist: a deleted chat's unread texts are not waiting for you
  const unreadMap = useUiStore((s) => s.unreadChats);
  const chats = useFableStore((s) => s.chats);
  const unread = chats.reduce((a, c) => a + (unreadMap[c.id] ?? 0), 0);
  return (
    <div className="flex h-11 flex-shrink-0 items-center gap-2 border-b border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] px-2">
      <button onClick={() => setNavOpenAt(key)} aria-label={ringing ? "Open menu (a call is ringing)" : unread ? `Open menu (${unread} new)` : "Open menu"}
        className="relative rounded-lg p-2 cursor-pointer text-[var(--foreground)] hover:bg-[var(--muted)]">
        <Menu className="h-5 w-5" />
        {ringing ? (
          <span aria-hidden className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-[var(--sidebar-bg)] animate-pulse" />
        ) : unread > 0 && (
          <span aria-hidden className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white ring-2 ring-[var(--sidebar-bg)] tabular-nums">{unread > 9 ? "9+" : unread}</span>
        )}
      </button>
      <div className="h-6 w-6 rounded-md bg-[var(--purple)] flex items-center justify-center flex-shrink-0">
        <Sparkles className="h-3.5 w-3.5 text-white" />
      </div>
      <span className="truncate text-sm font-semibold text-[var(--foreground)]">{title}</span>
    </div>
  );
}

export function NavDrawer() {
  const key = useNavKey();
  const { navOpenAt, setNavOpenAt } = useUiStore();
  const open = navOpenAt === key;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setNavOpenAt(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setNavOpenAt]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="h-full max-w-[85vw] shadow-xl">
        <Sidebar />
      </div>
      <button aria-label="Close menu" onClick={() => setNavOpenAt(null)} className="flex-1 bg-black/40 cursor-default" />
    </div>
  );
}

"use client";

import { useState } from "react";
import { useFableStore, type SidebarSection } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { NavItem } from "./NavItem";
import { SystemStatus } from "./SystemStatus";
import { ContactPill } from "./ContactPill";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { truncate, formatAgeFromIso } from "@/lib/utils";
import type { Chat, Character } from "@/lib/types";
import { answerCall, declineCall } from "@/lib/chat/calls";
import { DeleteChatDialog } from "@/components/chat/DeleteChatDialog";
import { unlockSounds } from "@/lib/chat/sounds";
import {
  MessageSquare, Archive, Group, BookOpen, Sliders, ImageIcon, GalleryHorizontal, GitBranch, Settings, Plus, Sparkles, Pencil, Trash2, Clapperboard, Library, MessageSquareQuote, Phone, PhoneOff, PhoneMissed, MessageCircle,
} from "lucide-react";
import { useUiStore } from "@/lib/store/ui";

export const NAV_ITEMS: { id: SidebarSection; label: string; icon: React.ElementType }[] = [
  { id: "characters", label: "Library", icon: Library },
  { id: "chats", label: "Chats", icon: MessageSquare },
  { id: "archive", label: "Archive", icon: Archive },
  { id: "groups", label: "Groups", icon: Group },
  { id: "lorebooks", label: "Lorebooks", icon: BookOpen },
  { id: "scenarios", label: "Scenarios", icon: Clapperboard },
  { id: "openers", label: "First messages", icon: MessageSquareQuote },
  { id: "presets", label: "Presets", icon: Sliders },
  { id: "image-studio", label: "Image Studio", icon: ImageIcon },
  { id: "gallery", label: "Gallery", icon: GalleryHorizontal },
  { id: "workflows", label: "Workflows", icon: GitBranch },
  { id: "settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const { setActiveChatId, chats, characters, activeChatId } = useFableStore();
  const { activeSection, setActiveSection, setChatBuilderOpen, setNavOpenAt } = useUiStore();

  // All chats, newest first. This list is the only way to open a chat, so it
  // must never be capped — a slice(0, 8) here once made older chats
  // permanently unreachable. The container scrolls.
  // Archived chats are put away: not in Recent Chats (the Chats screen can show them)
  const recentChats = chats.filter((c) => !c.archived)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return (
    <aside className="flex flex-col h-full w-[220px] flex-shrink-0 border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]">
      {/* Logo */}
      <div className="px-4 pt-5 pb-4 border-b border-[var(--sidebar-border)]">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-[var(--purple)] flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="font-bold text-[var(--foreground)] text-sm leading-none">FableChat</div>
            <div className="text-[10px] text-[var(--muted-fg)] leading-none mt-0.5">Local AI Studio</div>
          </div>
        </div>
      </div>

      {/* New Chat Button */}
      <div className="px-3 pt-3 pb-2">
        <Button
          variant="purple"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => { setNavOpenAt(null); setChatBuilderOpen(true); }}
        >
          <Plus className="h-3.5 w-3.5" />
          New Chat
        </Button>
      </div>

      {/* Navigation */}
      <nav className="px-2 space-y-0.5 pb-2">
        {NAV_ITEMS.map((item) => (
          <NavItem
            key={item.id}
            icon={item.icon}
            label={item.label}
            active={activeSection === item.id}
            onClick={() => {
              setActiveSection(item.id);
              // "Chats" means browse them all. Jumping straight back into
              // whichever was last open makes the list unreachable.
              if (item.id === "chats" || item.id === "archive") setActiveChatId(null);
            }}
          />
        ))}
      </nav>

      {/* Recent Chats */}
      <div className="flex-1 overflow-y-auto px-2 py-2 border-t border-[var(--sidebar-border)]">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-fg)] px-2 mb-1.5">
          Recent Chats
        </div>
        <div className="space-y-0.5">
          {recentChats.map((chat) => (
            <ChatRow
              key={chat.id}
              chat={chat}
              character={characters.find((c) => c.id === chat.characterId)}
              isActive={chat.id === activeChatId}
            />
          ))}
        </div>
      </div>

      {/* Your status and Pause all, while Contact & media is on */}
      <ContactPill />

      {/* System Status */}
      <SystemStatus />
    </aside>
  );
}

// ─── Chat row ─────────────────────────────────────────────────────────────────
// A div (not a button) so the hover rename/delete controls can nest inside.

function ChatRow({
  chat,
  character,
  isActive,
}: {
  chat: Chat;
  character?: Character;
  isActive: boolean;
}) {
  const { setActiveChatId, renameChat } = useFableStore();
  const { setActiveSection } = useUiStore();
  const unread = useUiStore((s) => s.unreadChats[chat.id] ?? 0);
  // What just came in on this chat, shown on its row rather than over the screen
  const ringing = useUiStore((s) => s.call?.phase === "incoming" && s.call.chatId === chat.id);

  const [renaming,      setRenaming]      = useState(false);
  const [draft,         setDraft]         = useState(chat.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Relative times depend on the current clock, so they can't be rendered
  // during SSR without a hydration mismatch.
  const hydrated = useHydrated();

  const lastMsg = chat.messages[chat.messages.length - 1];
  const missed = unread > 0 && lastMsg?.callEvent?.kind === "missed";
  const newText = unread > 0 && !missed && lastMsg?.channel === "text";

  const commitRename = () => {
    renameChat(chat.id, draft);
    setRenaming(false);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => { setActiveChatId(chat.id); setActiveSection("chats"); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !renaming) {
          setActiveChatId(chat.id);
          setActiveSection("chats");
        }
      }}
      className={`group w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
        isActive
          ? "bg-[var(--purple-light)] text-[var(--purple-fg)]"
          : "hover:bg-[var(--muted)] text-[var(--foreground)]"
      }`}
    >
      <div className="relative flex-shrink-0">
        <Avatar name={character?.name ?? chat.name} src={character?.avatar ?? character?.referenceImages?.[0]} size="xs" />
        {/* How many came in, like a phone's badge: red, top right, "9+" past nine */}
        {unread > 0 && !ringing && (
          <span aria-label={`${unread} new`} className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white ring-2 ring-[var(--sidebar-bg)] tabular-nums">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
        {/* What it was, small, bottom right: ringing (the only one that moves, gently), a text, or a missed call */}
        {(ringing || newText || missed) && (
          <span aria-hidden className={`absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-2 ring-[var(--sidebar-bg)] ${
            missed ? "bg-red-500" : "bg-green-500"} ${ringing ? "animate-pulse" : ""}`}>
            {ringing ? <Phone className="h-2 w-2 text-white" /> : missed ? <PhoneMissed className="h-2 w-2 text-white" /> : <MessageCircle className="h-2 w-2 text-white" />}
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") { setDraft(chat.name); setRenaming(false); }
            }}
            className="w-full rounded border border-[var(--purple)] bg-[var(--card)] px-1 py-0.5 text-xs text-[var(--foreground)] focus:outline-none"
          />
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <span className={`text-xs truncate ${unread ? "font-bold" : "font-medium"}`}>{chat.name}</span>
            </div>
            {ringing ? (
              <div className="text-[10px] font-medium text-green-600 dark:text-green-400 truncate" role="status">Calling you…</div>
            ) : missed ? (
              <div className="text-[10px] font-medium text-red-500 truncate">Missed call</div>
            ) : lastMsg?.callEvent ? (
              <div className="text-[10px] text-[var(--muted-fg)] truncate">{lastMsg.callEvent.kind === "ended" ? "Call ended" : lastMsg.callEvent.kind === "declined" ? "Declined call" : "Call"}</div>
            ) : lastMsg && (
              <div className={`text-[10px] truncate ${newText ? "text-[var(--foreground)]" : "text-[var(--muted-fg)]"}`}>
                {truncate(lastMsg.content, 30)}
              </div>
            )}
          </>
        )}
      </div>

      {ringing && !renaming && (
        // Answer or decline right here; answering opens the call screen
        <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <button onClick={declineCall} aria-label="Decline call" title="Decline"
            className="flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 cursor-pointer"><PhoneOff className="h-3 w-3" /></button>
          <button onClick={() => { unlockSounds(); void answerCall(); }} aria-label="Answer call" title="Answer"
            className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-white hover:bg-green-600 cursor-pointer"><Phone className="h-3 w-3" /></button>
        </div>
      )}
      {!renaming && !ringing && (
        <>
          {/* Timestamp — swapped for actions on hover */}
          <div className="text-[10px] text-[var(--muted-fg)] flex-shrink-0 group-hover:hidden">
            {hydrated ? formatAgeFromIso(chat.updatedAt) : ""}
          </div>
          <div
            className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              title="Rename chat"
              onClick={() => { setDraft(chat.name); setRenaming(true); }}
              className="rounded p-1 text-[var(--muted-fg)] hover:bg-[var(--border)] hover:text-[var(--foreground)] transition-colors"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              title="Delete chat"
              onClick={() => setConfirmDelete(true)}
              className="rounded p-1 text-[var(--muted-fg)] hover:bg-[var(--border)] hover:text-red-500 transition-colors"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </>
      )}

      {/* Deleting a chat purges its memory too — always ask first */}
      <DeleteChatDialog chat={chat} open={confirmDelete} onClose={() => setConfirmDelete(false)} />
    </div>
  );
}

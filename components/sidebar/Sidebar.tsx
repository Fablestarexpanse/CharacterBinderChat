"use client";

import { useState } from "react";
import { useFableStore, type SidebarSection } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { NavItem } from "./NavItem";
import { SystemStatus } from "./SystemStatus";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { truncate, formatRelative } from "@/lib/utils";
import type { Chat, Character } from "@/lib/types";
import {
  Users,
  MessageSquare,
  Group,
  BookOpen,
  Sliders,
  ImageIcon,
  GalleryHorizontal,
  GitBranch,
  Settings,
  Plus,
  Sparkles,
  Pencil,
  Trash2,
  Clapperboard,
} from "lucide-react";

const NAV_ITEMS: { id: SidebarSection; label: string; icon: React.ElementType }[] = [
  { id: "characters", label: "Characters", icon: Users },
  { id: "chats", label: "Chats", icon: MessageSquare },
  { id: "groups", label: "Groups", icon: Group },
  { id: "lorebooks", label: "Lorebooks", icon: BookOpen },
  { id: "scenarios", label: "Scenarios", icon: Clapperboard },
  { id: "presets", label: "Presets", icon: Sliders },
  { id: "image-studio", label: "Image Studio", icon: ImageIcon },
  { id: "gallery", label: "Gallery", icon: GalleryHorizontal },
  { id: "workflows", label: "Workflows", icon: GitBranch },
  { id: "settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const { activeSection, setActiveSection, setActiveChatId, chats, characters, activeChatId, setChatBuilderOpen } =
    useFableStore();

  // All chats, newest first. This list is the only way to open a chat, so it
  // must never be capped — a slice(0, 8) here once made older chats
  // permanently unreachable. The container scrolls.
  const recentChats = [...chats]
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
          onClick={() => setChatBuilderOpen(true)}
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
              if (item.id === "chats") setActiveChatId(null);
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
  const { setActiveChatId, setActiveSection, renameChat, deleteChat } = useFableStore();

  const [renaming,      setRenaming]      = useState(false);
  const [draft,         setDraft]         = useState(chat.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Relative times depend on the current clock, so they can't be rendered
  // during SSR without a hydration mismatch.
  const hydrated = useHydrated();

  const lastMsg = chat.messages[chat.messages.length - 1];

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
      <Avatar name={character?.name ?? chat.name} src={character?.avatar} size="xs" />

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
            className="w-full rounded border border-[var(--purple)] bg-white px-1 py-0.5 text-xs text-[var(--foreground)] focus:outline-none"
          />
        ) : (
          <>
            <div className="text-xs font-medium truncate">{chat.name}</div>
            {lastMsg && (
              <div className="text-[10px] text-[var(--muted-fg)] truncate">
                {truncate(lastMsg.content, 30)}
              </div>
            )}
          </>
        )}
      </div>

      {!renaming && (
        <>
          {/* Timestamp — swapped for actions on hover */}
          <div className="text-[10px] text-[var(--muted-fg)] flex-shrink-0 group-hover:hidden">
            {hydrated ? formatRelative(chat.updatedAt) : ""}
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
      <Dialog open={confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(false)}>
        <DialogContent
          className="max-w-sm p-5"
          aria-describedby={undefined}
          onClick={(e) => e.stopPropagation()}
        >
          <DialogTitle>Delete “{chat.name}”?</DialogTitle>
          <p className="text-xs text-[var(--muted-fg)] mt-2 leading-relaxed">
            This permanently deletes the chat and everything the character
            remembers from it — {chat.messages.length} message{chat.messages.length !== 1 ? "s" : ""},
            facts, stats, and episodes. This can’t be undone.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => { setConfirmDelete(false); deleteChat(chat.id); }}
            >
              <Trash2 className="h-3 w-3 mr-1.5" />
              Delete chat
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

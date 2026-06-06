"use client";

import { useFableStore, type SidebarSection } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { NavItem } from "./NavItem";
import { SystemStatus } from "./SystemStatus";
import { truncate, formatRelative } from "@/lib/utils";
import {
  Users,
  MessageSquare,
  Group,
  BookOpen,
  Sliders,
  ImageIcon,
  GalleryHorizontal,
  GitBranch,
  Puzzle,
  Settings,
  Plus,
  Sparkles,
} from "lucide-react";

const NAV_ITEMS: { id: SidebarSection; label: string; icon: React.ElementType }[] = [
  { id: "characters", label: "Characters", icon: Users },
  { id: "chats", label: "Chats", icon: MessageSquare },
  { id: "groups", label: "Groups", icon: Group },
  { id: "lorebooks", label: "Lorebooks", icon: BookOpen },
  { id: "presets", label: "Presets", icon: Sliders },
  { id: "image-studio", label: "Image Studio", icon: ImageIcon },
  { id: "gallery", label: "Gallery", icon: GalleryHorizontal },
  { id: "workflows", label: "Workflows", icon: GitBranch },
  { id: "extensions", label: "Extensions", icon: Puzzle },
  { id: "settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const { activeSection, setActiveSection, chats, characters, activeChatId, setActiveChatId, createChat } =
    useFableStore();

  const recentChats = [...chats]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 8);

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
          onClick={() => { createChat(); setActiveSection("chats"); }}
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
            onClick={() => setActiveSection(item.id)}
          />
        ))}
      </nav>

      {/* Recent Chats */}
      <div className="flex-1 overflow-y-auto px-2 py-2 border-t border-[var(--sidebar-border)]">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-fg)] px-2 mb-1.5">
          Recent Chats
        </div>
        <div className="space-y-0.5">
          {recentChats.map((chat) => {
            const character = characters.find((c) => c.id === chat.characterId);
            const lastMsg = chat.messages[chat.messages.length - 1];
            const isActive = chat.id === activeChatId;
            return (
              <button
                key={chat.id}
                onClick={() => { setActiveChatId(chat.id); setActiveSection("chats"); }}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                  isActive
                    ? "bg-[var(--purple-light)] text-[var(--purple-fg)]"
                    : "hover:bg-[var(--muted)] text-[var(--foreground)]"
                }`}
              >
                <Avatar name={character?.name ?? chat.name} src={character?.avatar} size="xs" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{chat.name}</div>
                  {lastMsg && (
                    <div className="text-[10px] text-[var(--muted-fg)] truncate">
                      {truncate(lastMsg.content, 30)}
                    </div>
                  )}
                </div>
                <div className="text-[10px] text-[var(--muted-fg)] flex-shrink-0">
                  {formatRelative(chat.updatedAt)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* System Status */}
      <SystemStatus />
    </aside>
  );
}

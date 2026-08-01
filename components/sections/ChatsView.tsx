"use client";

// ─── Chats ────────────────────────────────────────────────────────────────────
// Browse every saved conversation. Clicking the Chats nav item lands here
// rather than dropping straight into whichever chat happened to be open —
// with more than a couple of stories going, "take me to the last one" is the
// wrong default. Opening a chat sets activeChatId; the header's back button
// clears it to come back here.

import { useState } from "react";
import { useFableStore } from "@/lib/store";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { formatRelative, truncate } from "@/lib/utils";
import { MessageSquare, Search, Plus, Users, ImageIcon } from "lucide-react";

export function ChatsView() {
  const {
    chats, characters, setActiveChatId, setChatBuilderOpen,
  } = useFableStore();
  const [query, setQuery] = useState("");
  // Relative times depend on the clock, so they can't render during SSR
  const hydrated = useHydrated();

  const q = query.trim().toLowerCase();
  const visible = [...chats]
    .filter((c) => {
      if (!q) return true;
      const character = characters.find((ch) => ch.id === c.characterId)?.name ?? "";
      return (
        c.name.toLowerCase().includes(q) ||
        character.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-white">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Chats</h1>
            <p className="text-sm text-[var(--muted-fg)] mt-1">
              {chats.length} conversation{chats.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-56">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-fg)] pointer-events-none" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chats and messages…"
                className="pl-8 h-9 text-xs"
              />
            </div>
            <Button variant="purple" size="md" onClick={() => setChatBuilderOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              New Chat
            </Button>
          </div>
        </div>

        {visible.length === 0 && (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-10 text-center">
            <MessageSquare className="h-6 w-6 text-[var(--muted-fg)] mx-auto mb-2" />
            <div className="text-sm text-[var(--muted-fg)]">
              {q ? `No chats match “${query}”.` : "No chats yet — start one to begin a story."}
            </div>
          </div>
        )}

        <div className="space-y-2">
          {visible.map((chat) => {
            const character = characters.find((c) => c.id === chat.characterId);
            const members = (chat.memberIds ?? [])
              .map((id) => characters.find((c) => c.id === id))
              .filter(Boolean);
            const isGroup = members.length >= 2;
            const lastMsg = [...chat.messages].reverse().find((m) => !m.imageJobId && m.content.trim());
            const imageCount = chat.messages.filter((m) => m.imageJobId).length;

            return (
              <button
                key={chat.id}
                onClick={() => setActiveChatId(chat.id)}
                className="w-full flex items-start gap-3 rounded-xl border border-[var(--border)] p-3 text-left hover:border-[var(--purple)] hover:bg-[var(--purple-light)] transition-colors cursor-pointer"
              >
                {isGroup ? (
                  <div className="flex -space-x-2 flex-shrink-0">
                    {members.slice(0, 3).map((m) => (
                      <Avatar key={m!.id} name={m!.name} src={m!.avatar} size="sm" />
                    ))}
                  </div>
                ) : (
                  <Avatar name={character?.name ?? chat.name} src={character?.avatar} size="md" />
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-[var(--foreground)] truncate">
                      {chat.name}
                    </span>
                    {isGroup && (
                      <Badge variant="purple">
                        <Users className="h-2.5 w-2.5 mr-0.5" />
                        group
                      </Badge>
                    )}
                    {imageCount > 0 && (
                      <Badge variant="default">
                        <ImageIcon className="h-2.5 w-2.5 mr-0.5" />
                        {imageCount}
                      </Badge>
                    )}
                  </div>
                  {lastMsg && (
                    <p className="text-xs text-[var(--muted-fg)] mt-0.5 line-clamp-2 leading-snug">
                      {truncate(lastMsg.content, 160)}
                    </p>
                  )}
                </div>

                <div className="flex-shrink-0 text-right">
                  <div className="text-[10px] text-[var(--muted-fg)]">
                    {hydrated ? formatRelative(chat.updatedAt) : ""}
                  </div>
                  <div className="text-[10px] text-[var(--muted-fg)] mt-0.5">
                    {chat.messages.length} message{chat.messages.length === 1 ? "" : "s"}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

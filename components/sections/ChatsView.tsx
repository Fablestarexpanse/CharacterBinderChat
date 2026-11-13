"use client";

// ─── Chats ────────────────────────────────────────────────────────────────────
// Browse every saved conversation. Clicking the Chats nav item lands here
// rather than dropping straight into whichever chat happened to be open —
// with more than a couple of stories going, "take me to the last one" is the
// wrong default. Opening a chat sets activeChatId; the header's back button
// clears it to come back here. Each chat can be archived (put away, nothing
// lost), exported (ExportChatDialog) or deleted, which always asks first. The same view with `archived`
// is the Archive section: only archived chats, each with Unarchive.

import { useState } from "react";
import { useFableStore } from "@/lib/store";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHydrated } from "@/lib/hooks/useHydrated";
import { formatAgeFromIso, truncate } from "@/lib/utils";
import { MessageSquare, Search, Plus, Users, ImageIcon, Archive, ArchiveRestore, Trash2, Download } from "lucide-react";
import { useUiStore } from "@/lib/store/ui";
import { DeleteChatDialog } from "@/components/chat/DeleteChatDialog";
import { ExportChatDialog } from "@/components/chat/ExportChatDialog";
import type { Chat } from "@/lib/types";

export function ChatsView({ archived: showArchived = false }: { archived?: boolean } = {}) {
  const { chats, characters, setActiveChatId, setChatArchived } = useFableStore();
  const { setChatBuilderOpen, setActiveSection } = useUiStore();
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<Chat | null>(null);
  const [exporting, setExporting] = useState<Chat | null>(null);
  const archivedCount = chats.filter((c) => c.archived).length;
  // Relative times depend on the clock, so they can't render during SSR
  const hydrated = useHydrated();

  const q = query.trim().toLowerCase();
  const visible = [...chats]
    .filter((c) => !!c.archived === showArchived)
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
    <div className="flex-1 overflow-y-auto p-6 bg-[var(--card)]">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">{showArchived ? "Archive" : "Chats"}</h1>
            <p className="text-sm text-[var(--muted-fg)] mt-1">
              {showArchived
                ? `${archivedCount} archived chat${archivedCount === 1 ? "" : "s"}: put away, nothing deleted. Unarchive one to bring it back to Chats.`
                : `${chats.length - archivedCount} conversation${chats.length - archivedCount === 1 ? "" : "s"}`}
              {!showArchived && archivedCount > 0 && (
                <button onClick={() => setActiveSection("archive")} className="ml-2 underline cursor-pointer hover:text-[var(--foreground)]">
                  {archivedCount} in Archive
                </button>
              )}
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
              {q ? `No chats match “${query}”.` : showArchived ? "Nothing archived." : "No chats yet — start one to begin a story."}
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
              <div key={chat.id}
                className="group flex items-start gap-2 rounded-xl border border-[var(--border)] p-3 hover:border-[var(--purple)] hover:bg-[var(--purple-light)] transition-colors">
              <button
                onClick={() => setActiveChatId(chat.id)}
                aria-label={`Open ${chat.name}`}
                className="flex flex-1 min-w-0 items-start gap-3 text-left cursor-pointer"
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
                    {hydrated ? formatAgeFromIso(chat.updatedAt) : ""}
                  </div>
                  <div className="text-[10px] text-[var(--muted-fg)] mt-0.5">
                    {chat.messages.length} message{chat.messages.length === 1 ? "" : "s"}
                  </div>
                </div>
              </button>
              <div className="flex flex-col gap-1 flex-shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7"
                  title={chat.archived ? "Bring back to Chats" : "Archive: put it away, nothing is deleted"}
                  aria-label={chat.archived ? `Unarchive ${chat.name}` : `Archive ${chat.name}`}
                  onClick={() => setChatArchived(chat.id, !chat.archived)}>
                  {chat.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" title="Export: a web page, Markdown, text, SillyTavern or FableChat file, with or without pictures"
                  aria-label={`Export ${chat.name}`} onClick={() => setExporting(chat)}>
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-red-600" title="Delete this chat and its memory"
                  aria-label={`Delete ${chat.name}`} onClick={() => setDeleting(chat)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              </div>
            );
          })}
        </div>
      </div>
      {deleting && <DeleteChatDialog chat={deleting} open onClose={() => setDeleting(null)} />}
      {exporting && <ExportChatDialog chat={exporting} open onClose={() => setExporting(null)} />}
    </div>
  );
}

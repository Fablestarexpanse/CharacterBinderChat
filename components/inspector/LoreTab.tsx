"use client";

import { useFableStore } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { estimateTokens } from "@/lib/chat/promptBuilder";
import { entryTriggered, booksForChat, LORE_TOKEN_BUDGET } from "@/lib/chat/lorebook";
import { BookOpen, Zap, Pencil, Globe, Check } from "lucide-react";
import { useUiStore } from "@/lib/store/ui";

export function LoreTab() {
  const { lorebooks, chats, activeChatId, setChatLorebooks } = useFableStore();
  const { setActiveSection } = useUiStore();

  const chat = chats.find((c) => c.id === activeChatId);
  const recentText = (chat?.messages ?? []).slice(-6).map((m) => m.content).join("\n").toLowerCase();

  // Which worlds are in play for THIS chat (undefined selection = all)
  const activeBooks = booksForChat(lorebooks, chat);
  const activeIds = new Set(activeBooks.map((b) => b.id));

  const toggleBook = (id: string) => {
    if (!chat) return;
    const next = new Set(activeIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Selecting every book stores undefined — new books then join automatically
    setChatLorebooks(chat.id, next.size === lorebooks.length ? undefined : [...next]);
  };

  const allEnabled = activeBooks.flatMap((b) =>
    b.entries.filter((e) => e.enabled).map((e) => ({ ...e, bookName: b.name }))
  );
  // Literally the same trigger predicate generation uses — a reimplementation
  // here once diverged (substring vs word-boundary) and showed entries as
  // injected that generation skipped.
  const triggered = allEnabled.filter((e) => entryTriggered(e, recentText));
  const triggeredTokens = triggered.reduce(
    (sum, e) => sum + estimateTokens(`${e.key.split(",")[0]?.trim()}: ${e.value.trim()}`),
    0
  );

  return (
    <div className="p-4 space-y-4">
      {/* Summary + edit link */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-[var(--purple-fg)]" />
          <div>
            <div className="text-sm font-medium text-[var(--foreground)]">
              {activeBooks.length} of {lorebooks.length} world{lorebooks.length !== 1 ? "s" : ""} active
            </div>
            <div className="text-[10px] text-[var(--muted-fg)]">
              {allEnabled.length} enabled · {triggered.length} triggered by this scene
            </div>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="h-7" onClick={() => setActiveSection("lorebooks")}>
          <Pencil className="h-3 w-3 mr-1" />
          Edit
        </Button>
      </div>

      {/* Which worlds apply to this chat */}
      {lorebooks.length > 0 && chat && (
        <div>
          <div className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider mb-2">
            Worlds in this chat
          </div>
          <div className="space-y-1">
            {lorebooks.map((book) => {
              const active = activeIds.has(book.id);
              return (
                <button
                  key={book.id}
                  onClick={() => toggleBook(book.id)}
                  className={`w-full flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors cursor-pointer ${
                    active
                      ? "border-[var(--purple)] bg-[var(--purple-light)]"
                      : "border-[var(--border)] bg-white hover:bg-[var(--muted)]"
                  }`}
                >
                  <Globe className={`h-3.5 w-3.5 flex-shrink-0 ${active ? "text-[var(--purple-fg)]" : "text-[var(--muted-fg)]"}`} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs font-medium truncate ${active ? "text-[var(--purple-fg)]" : "text-[var(--foreground)]"}`}>
                      {book.name}
                    </div>
                    <div className="text-[10px] text-[var(--muted-fg)]">
                      {book.entries.length} entr{book.entries.length !== 1 ? "ies" : "y"}
                    </div>
                  </div>
                  {active && <Check className="h-3.5 w-3.5 text-[var(--purple-fg)] flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Token usage of currently-triggered entries */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5 text-xs text-[var(--muted-fg)]">
            <Zap className="h-3 w-3" />
            Injected now
          </div>
          <span className="text-xs font-medium text-[var(--foreground)]">{triggeredTokens} tokens</span>
        </div>
        <div className="h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--purple)]"
            style={{ width: `${Math.min((triggeredTokens / LORE_TOKEN_BUDGET) * 100, 100)}%` }}
          />
        </div>
        <div className="text-[10px] text-[var(--muted-fg)] mt-1">
          {triggeredTokens} / {LORE_TOKEN_BUDGET} budget
        </div>
      </div>

      {/* Triggered entries */}
      <div>
        <div className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider mb-2">
          Triggered Entries
        </div>
        {triggered.length === 0 ? (
          <div className="text-[11px] text-[var(--muted-fg)]">
            Nothing triggered — entries fire when their keywords appear in the last few messages.
          </div>
        ) : (
          <div className="space-y-2">
            {triggered.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-[var(--border)] bg-white p-2.5">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-xs font-medium text-[var(--purple-fg)]">{entry.key}</span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className="text-[10px] text-[var(--muted-fg)]">{entry.bookName}</span>
                    <Badge variant="default">
                      {estimateTokens(`${entry.key}: ${entry.value}`)}t
                    </Badge>
                    {(entry.priority ?? 0) >= 10 && <Badge variant="purple">high</Badge>}
                  </div>
                </div>
                <p className="text-[11px] text-[var(--foreground)] leading-relaxed line-clamp-2">
                  {entry.value}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

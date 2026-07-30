"use client";

import { useFableStore } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { estimateTokens } from "@/lib/chat/promptBuilder";
import { entryKeywords, LORE_TOKEN_BUDGET } from "@/lib/chat/lorebook";
import { BookOpen, Zap, Pencil } from "lucide-react";

export function LoreTab() {
  const { lorebooks, chats, activeChatId, setActiveSection } = useFableStore();

  const chat = chats.find((c) => c.id === activeChatId);
  const recentText = (chat?.messages ?? []).slice(-6).map((m) => m.content).join("\n").toLowerCase();

  const allEnabled = lorebooks.flatMap((b) =>
    b.entries.filter((e) => e.enabled).map((e) => ({ ...e, bookName: b.name }))
  );
  // Same trigger logic as generation: constant entries always inject,
  // keyword entries fire when a keyword appears in recent turns.
  const triggered = allEnabled.filter(
    (e) => e.constant || entryKeywords(e).some((k) => k && recentText.includes(k))
  );
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
              {lorebooks.length} lorebook{lorebooks.length !== 1 ? "s" : ""}
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

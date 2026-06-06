"use client";

import { useFableStore } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookOpen, Zap, Plus } from "lucide-react";

export function LoreTab() {
  const { lorebooks } = useFableStore();
  const activeLorebook = lorebooks[0];

  const enabledEntries = activeLorebook?.entries.filter((e) => e.enabled) ?? [];
  const totalTokens = enabledEntries.reduce((sum, e) => sum + (e.tokens ?? 0), 0);

  return (
    <div className="p-4 space-y-4">
      {/* Active lorebook */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-[var(--purple-fg)]" />
          <div>
            <div className="text-sm font-medium text-[var(--foreground)]">
              {activeLorebook?.name ?? "No lorebook"}
            </div>
            <div className="text-[10px] text-[var(--muted-fg)]">
              {enabledEntries.length} active entries
            </div>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="h-7">
          Change
        </Button>
      </div>

      {/* Token usage */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5 text-xs text-[var(--muted-fg)]">
            <Zap className="h-3 w-3" />
            Token usage
          </div>
          <span className="text-xs font-medium text-[var(--foreground)]">{totalTokens} tokens</span>
        </div>
        <div className="h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--purple)]"
            style={{ width: `${Math.min((totalTokens / 500) * 100, 100)}%` }}
          />
        </div>
        <div className="text-[10px] text-[var(--muted-fg)] mt-1">{totalTokens} / 500 budget</div>
      </div>

      {/* Entries */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider">
            Active Entries
          </div>
          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]">
            <Plus className="h-3 w-3 mr-0.5" /> Add
          </Button>
        </div>
        <div className="space-y-2">
          {enabledEntries.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-[var(--border)] bg-white p-2.5">
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-[var(--purple-fg)]">{entry.key}</span>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Badge variant="default">{entry.tokens}t</Badge>
                  {entry.priority && entry.priority >= 10 && (
                    <Badge variant="purple">high</Badge>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-[var(--foreground)] leading-relaxed line-clamp-2">
                {entry.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useFableStore } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pin, Brain, Loader2, RefreshCw } from "lucide-react";

interface EnrichedFact {
  id:            number;
  predicate:     string;
  objectDisplay: string;
  confidence:    number;
  tValidStart:   number;
}

interface PinnedMemory {
  id:      string;
  content: string;
  type:    string;
}

function formatRelativeTime(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60)  return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function MemoryTab() {
  const { activeChatId, chats, characters, extractionVersion, isExtracting, memories } =
    useFableStore();

  const chat      = chats.find((c) => c.id === activeChatId);
  const character = characters.find((c) => c.id === chat?.characterId);

  const [facts, setFacts]       = useState<EnrichedFact[]>([]);
  const [loading, setLoading]   = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Pinned memories from Zustand (manual / legacy)
  const pinned: PinnedMemory[] = memories
    .filter((m) => m.chatId === activeChatId && m.pinned)
    .map((m) => ({ id: m.id, content: m.content, type: m.type }));

  const fetchFacts = () => {
    if (!character) return;
    setLoading(true);
    setFetchError(null);
    fetch(`/api/drawer/facts?subject=${encodeURIComponent(character.id)}`)
      .then((r) => r.json())
      .then((data: { facts?: EnrichedFact[]; error?: string }) => {
        if (data.error) throw new Error(data.error);
        setFacts(data.facts ?? []);
      })
      .catch((err: Error) => setFetchError(err.message))
      .finally(() => setLoading(false));
  };

  // Re-fetch when character changes or extraction completes
  useEffect(() => {
    fetchFacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character?.id, extractionVersion]);

  // ── No character ────────────────────────────────────────────────────────

  if (!character) {
    return (
      <div className="p-4 text-center text-sm text-[var(--muted-fg)]">
        No character assigned to this chat.
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">

      {/* Pinned memories */}
      {pinned.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider flex items-center gap-1.5">
              <Pin className="h-3 w-3" />
              Pinned
            </div>
          </div>
          <div className="space-y-2">
            {pinned.map((m) => (
              <div
                key={m.id}
                className="rounded-lg border border-[var(--border)] bg-[var(--purple-light)] p-2.5"
              >
                <p className="text-xs text-[var(--foreground)] leading-relaxed">{m.content}</p>
                <div className="mt-1.5">
                  <Badge variant="purple">{m.type}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Extracted facts from knowledge graph */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider flex items-center gap-1.5">
            <Brain className="h-3 w-3" />
            Knowledge Graph
            {(loading || isExtracting) && (
              <Loader2 className="h-3 w-3 animate-spin text-[var(--purple-fg)]" />
            )}
          </div>
          <button
            onClick={fetchFacts}
            disabled={loading}
            className="text-[var(--muted-fg)] hover:text-[var(--foreground)] disabled:opacity-40 transition-colors"
            title="Refresh facts"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>

        {isExtracting && facts.length === 0 && (
          <div className="text-xs text-[var(--purple-fg)] italic flex items-center gap-1.5 py-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Extracting from conversation…
          </div>
        )}

        {fetchError && (
          <div className="text-xs text-red-500 bg-red-50 rounded p-2">{fetchError}</div>
        )}

        {!loading && !fetchError && facts.length === 0 && !isExtracting && (
          <div className="text-xs text-[var(--muted-fg)] italic">
            No facts recorded yet. Facts are extracted automatically after each exchange.
          </div>
        )}

        {facts.length > 0 && (
          <div className="space-y-1.5">
            {facts.map((f) => (
              <div
                key={f.id}
                className="rounded-lg border border-[var(--border)] bg-white p-2.5"
              >
                <p className="text-xs text-[var(--foreground)] leading-snug">
                  <span className="font-medium text-[var(--purple-fg)]">{f.predicate}</span>
                  {" "}
                  <span>{f.objectDisplay}</span>
                </p>
                <div className="flex items-center gap-2 mt-1.5">
                  {f.confidence < 1.0 && (
                    <Badge variant="default">{Math.round(f.confidence * 100)}%</Badge>
                  )}
                  <span className="text-[10px] text-[var(--muted-fg)]">
                    {formatRelativeTime(f.tValidStart)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick summary action */}
      <div>
        <div className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider mb-2">
          Summary
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3">
          <p className="text-xs text-[var(--muted-fg)] italic">
            Switch to the Summary tab for a full character overview.
          </p>
          <Button
            variant="subtle"
            size="sm"
            className="mt-2 w-full text-xs"
            onClick={() => useFableStore.getState().setInspectorTab("summary")}
          >
            Open Summary
          </Button>
        </div>
      </div>
    </div>
  );
}

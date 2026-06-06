"use client";

import { useEffect, useState } from "react";
import { useFableStore } from "@/lib/store";
import { Loader2, RefreshCw, User, MapPin, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CharacterSummaryData } from "@/lib/db/models";

// ─── Confidence badge ─────────────────────────────────────────────────────────

function ConfBadge({ confidence }: { confidence: number }) {
  if (confidence >= 1.0) return null;
  const pct = Math.round(confidence * 100);
  const color =
    pct >= 80 ? "text-green-600 bg-green-50"
    : pct >= 50 ? "text-yellow-600 bg-yellow-50"
    : "text-red-600 bg-red-50";
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${color}`}>{pct}%</span>
  );
}

// ─── Stat mini bar ────────────────────────────────────────────────────────────

const STAT_COLOR: Record<string, string> = {
  affection:  "#e879a0",
  trust:      "#4f9cf8",
  desire:     "#f97316",
  connection: "#8b5cf6",
  mood:       "#22d3ee",
};

function MiniStatBar({ name, value }: { name: string; value: number }) {
  const color = STAT_COLOR[name] ?? "#7c5cbf";
  const pct   = Math.min(100, Math.max(0, ((value + 100) / 200) * 100));
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span className="w-16 text-[var(--muted-fg)] capitalize flex-shrink-0">{name}</span>
      <div className="flex-1 h-1 rounded-full bg-[var(--border)]">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-8 text-right font-mono text-[var(--foreground)] flex-shrink-0">
        {value >= 0 ? `+${value.toFixed(0)}` : value.toFixed(0)}
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SummaryTab() {
  const { activeChatId, chats, characters, extractionVersion } = useFableStore();
  const chat      = chats.find((c) => c.id === activeChatId);
  const character = characters.find((c) => c.id === chat?.characterId);

  const [summary, setSummary]   = useState<CharacterSummaryData | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error,   setError]     = useState<string | null>(null);

  const fetchSummary = () => {
    if (!character) return;
    setLoading(true);
    setError(null);
    fetch(`/api/drawer/summary/${encodeURIComponent(character.id)}`)
      .then((r) => r.json())
      .then((data: CharacterSummaryData & { error?: string }) => {
        if (data.error) throw new Error(data.error);
        setSummary(data);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character?.id, extractionVersion]);

  // ── No character ──────────────────────────────────────────────────────────

  if (!character) {
    return (
      <div className="p-4 text-center text-sm text-[var(--muted-fg)]">
        No character assigned to this chat.
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-[var(--purple-fg)]" />
          <span className="font-semibold text-sm text-[var(--foreground)]">
            {character.name}
          </span>
        </div>
        <button
          onClick={fetchSummary}
          disabled={loading}
          className="text-[var(--muted-fg)] hover:text-[var(--foreground)] disabled:opacity-40 transition-colors"
          title="Refresh summary"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Loading state */}
      {loading && !summary && (
        <div className="flex items-center gap-2 text-xs text-[var(--muted-fg)] py-2">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading summary…
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-600">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && summary && summary.facts.length === 0 && summary.relationships.length === 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-4 text-center">
          <p className="text-xs text-[var(--muted-fg)]">
            No knowledge recorded yet for <strong>{character.name}</strong>.
          </p>
          <p className="text-xs text-[var(--muted-fg)] mt-1">
            Facts and relationship stats are extracted automatically as you chat.
          </p>
        </div>
      )}

      {summary && (
        <>
          {/* Active facts */}
          {summary.facts.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider mb-2">
                Active Facts ({summary.facts.length})
              </div>
              <div className="space-y-1.5">
                {summary.facts.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-white p-2.5"
                  >
                    <MapPin className="h-3 w-3 text-[var(--muted-fg)] mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[var(--foreground)] leading-snug">
                        <span className="font-medium text-[var(--purple-fg)]">{f.predicate}</span>
                        {" "}
                        <span className="break-words">{f.objectDisplay}</span>
                      </p>
                    </div>
                    <ConfBadge confidence={f.confidence} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Relationships */}
          {summary.relationships.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider mb-2">
                Relationships
              </div>
              <div className="space-y-3">
                {summary.relationships.map((rel) => (
                  <div
                    key={rel.targetId}
                    className="rounded-lg border border-[var(--border)] bg-white p-3"
                  >
                    <div className="text-xs font-semibold text-[var(--foreground)] mb-2">
                      {rel.targetName}
                    </div>
                    <div className="space-y-1.5">
                      {rel.stats.map((s) => (
                        <MiniStatBar key={s.name} name={s.name} value={s.value} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active commitments */}
          {summary.commitments.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider mb-2">
                Commitments
              </div>
              <div className="space-y-1.5">
                {summary.commitments.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-lg border border-amber-200 bg-amber-50 p-2.5"
                  >
                    <p className="text-xs text-[var(--foreground)]">{c.description}</p>
                    {c.promiseeId && (
                      <p className="text-[10px] text-[var(--muted-fg)] mt-1">to {c.promiseeId}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Export button */}
      <Button
        variant="outline"
        size="sm"
        className="w-full text-xs"
        onClick={() => {
          fetch("/api/drawer/entities")
            .then((r) => r.json())
            .then((d) => {
              const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
              const url  = URL.createObjectURL(blob);
              const a    = document.createElement("a");
              a.href     = url;
              a.download = "fablestore-export.json";
              a.click();
              URL.revokeObjectURL(url);
            })
            .catch(console.error);
        }}
      >
        Export Graph JSON
      </Button>
    </div>
  );
}

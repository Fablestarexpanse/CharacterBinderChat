"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { formatRelativeTime, formatAbsTime } from "./utils";

interface EnrichedFact {
  id:            number;
  predicate:     string;
  objectDisplay: string;
  confidence:    number;
  tValidStart:   number;
  tValidEnd:     number | null;
  supersededBy:  number | null;
}

interface Props {
  characterId:    string;
  extractionVersion: number;
  isExtracting:   boolean;
}

export function FactsView({ characterId, extractionVersion, isExtracting }: Props) {
  const [showHistory, setShowHistory] = useState(false);
  // Result keyed by what was fetched; `loading` is derived so the effect
  // never calls setState synchronously (react-hooks/set-state-in-effect).
  const [result, setResult] = useState<{ key: string; facts: EnrichedFact[]; error: string | null } | null>(null);

  const fetchKey = `${characterId}:${extractionVersion}:${showHistory ? 1 : 0}`;

  useEffect(() => {
    let cancelled = false;
    const key = `${characterId}:${extractionVersion}:${showHistory ? 1 : 0}`;
    const url = `/api/drawer/facts?subject=${encodeURIComponent(characterId)}${showHistory ? "&includeSuperseded=1" : ""}`;
    fetch(url)
      .then((r) => r.json())
      .then((data: { facts?: EnrichedFact[]; error?: string }) => {
        if (data.error) throw new Error(data.error);
        if (!cancelled) setResult({ key, facts: data.facts ?? [], error: null });
      })
      .catch((e: Error) => {
        if (!cancelled) setResult({ key, facts: [], error: e.message });
      });
    return () => { cancelled = true; };
  }, [characterId, extractionVersion, showHistory]);

  const loading = result?.key !== fetchKey;
  const facts   = result?.facts ?? [];
  const error   = result?.error ?? null;

  // Separate live from superseded for the history view
  const liveFacts       = facts.filter((f) => f.tValidEnd === null);
  const supersededFacts = facts.filter((f) => f.tValidEnd !== null);

  // Build a map: supersededBy fact ID → the fact(s) it replaced
  const predecessors = new Map<number, EnrichedFact[]>();
  for (const f of supersededFacts) {
    if (f.supersededBy !== null) {
      if (!predecessors.has(f.supersededBy)) predecessors.set(f.supersededBy, []);
      predecessors.get(f.supersededBy)!.push(f);
    }
  }

  return (
    <div className="space-y-2">
      {/* History toggle */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[var(--muted-fg)]">
          {showHistory ? `${facts.length} total (incl. history)` : `${liveFacts.length} live`}
        </span>
        <button
          onClick={() => setShowHistory((v) => !v)}
          className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
            showHistory
              ? "bg-[var(--purple-light)] border-[var(--purple)] text-[var(--purple-fg)]"
              : "border-[var(--border)] text-[var(--muted-fg)] hover:text-[var(--foreground)]"
          }`}
        >
          {showHistory ? "Hide history" : "Show history"}
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-1.5 text-[var(--muted-fg)] py-2">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span className="text-[11px]">Loading…</span>
        </div>
      )}

      {error && <div className="text-[10px] text-red-500 bg-red-50 rounded p-2">{error}</div>}

      {isExtracting && facts.length === 0 && (
        <div className="text-[11px] text-[var(--purple-fg)] italic flex items-center gap-1.5 py-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Extracting from conversation…
        </div>
      )}

      {!loading && !error && facts.length === 0 && !isExtracting && (
        <div className="text-[11px] text-[var(--muted-fg)] italic">
          No facts recorded yet. Facts are extracted automatically after each exchange.
        </div>
      )}

      {/* Live facts */}
      {liveFacts.length > 0 && (
        <div className="space-y-1.5">
          {liveFacts.map((f) => (
            <div key={f.id} className="rounded-lg border border-[var(--border)] bg-white p-2.5">
              <p className="text-[11px] text-[var(--foreground)] leading-snug">
                <span className="font-medium text-[var(--purple-fg)]">{f.predicate}</span>
                {" "}
                <span>{f.objectDisplay}</span>
              </p>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {f.confidence < 1.0 && (
                  <Badge variant="default">{Math.round(f.confidence * 100)}%</Badge>
                )}
                <span className="text-[10px] text-[var(--muted-fg)]">
                  {formatRelativeTime(f.tValidStart)}
                </span>
              </div>

              {/* Superseded predecessors (history mode) */}
              {showHistory && predecessors.has(f.id) && (
                <div className="mt-2 pl-2 border-l-2 border-[var(--border)] space-y-1">
                  {predecessors.get(f.id)!.map((old) => (
                    <div key={old.id} className="opacity-50">
                      <p className="text-[10px] text-[var(--foreground)] line-through leading-snug">
                        <span className="font-medium">{old.predicate}</span>
                        {" "}
                        <span>{old.objectDisplay}</span>
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="default" className="text-[9px] opacity-70">superseded</Badge>
                        <span className="text-[9px] text-[var(--muted-fg)]">
                          {formatAbsTime(old.tValidStart)} → {old.tValidEnd ? formatAbsTime(old.tValidEnd) : "?"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Orphaned superseded facts (no live replacement linked yet) */}
      {showHistory && supersededFacts.length > 0 && (
        (() => {
          const linked = new Set(liveFacts.flatMap((f) => (predecessors.get(f.id) ?? []).map((p) => p.id)));
          const orphaned = supersededFacts.filter((f) => !linked.has(f.id));
          if (orphaned.length === 0) return null;
          return (
            <div className="mt-2">
              <div className="text-[10px] font-semibold text-[var(--muted-fg)] uppercase tracking-wider mb-1.5">
                Older (no live successor)
              </div>
              <div className="space-y-1.5">
                {orphaned.map((f) => (
                  <div key={f.id} className="rounded-lg border border-[var(--border)] bg-[var(--muted)] p-2.5 opacity-50">
                    <p className="text-[10px] text-[var(--foreground)] line-through leading-snug">
                      <span className="font-medium">{f.predicate}</span> {f.objectDisplay}
                    </p>
                    <span className="text-[9px] text-[var(--muted-fg)]">
                      {formatAbsTime(f.tValidStart)} → {f.tValidEnd ? formatAbsTime(f.tValidEnd) : "?"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFableStore } from "@/lib/store";
import { Loader2, Trash2, Plus, X } from "lucide-react";
import { formatAgeFromUnixSeconds, formatDateFromUnixSeconds } from "./utils";
import { sendJson } from "@/lib/api/client";
import type { DrawerFact } from "@/lib/api/dto";
import { useDrawerRead } from "@/lib/hooks/useDrawerRead";

interface Props {
  chatId:         string;
  characterId:    string;
  extractionVersion: number;
  isExtracting:   boolean;
}

export function FactsView({ chatId, characterId, extractionVersion, isExtracting }: Props) {
  const bumpExtraction = useFableStore((s) => s.bumpExtraction);
  const [showHistory, setShowHistory] = useState(false);
  // Curation state: which fact is armed for deletion, and the add-fact draft
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ predicate: "", object: "" });
  const [writeError, setWriteError] = useState<string | null>(null);
  const url = `/api/drawer/facts?chatId=${encodeURIComponent(chatId)}&subject=${encodeURIComponent(characterId)}${showHistory ? "&includeSuperseded=1" : ""}`;
  const { data, error, loading } = useDrawerRead<{ facts?: DrawerFact[] }>(
    `${chatId}:${characterId}:${extractionVersion}:${showHistory ? 1 : 0}`, url);
  const facts = data?.facts ?? [];

  // bumpExtraction is the app-wide "memory changed" signal — every inspector
  // view keys its fetch off it, so one bump refreshes the graph and stats too.
  const handleDelete = async (factId: number) => {
    setBusyId(factId);
    setWriteError(null);
    try {
      await sendJson("DELETE",
        `/api/drawer/facts?chatId=${encodeURIComponent(chatId)}&factId=${factId}`);
      bumpExtraction();
    } catch (e) {
      setWriteError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
      setConfirmDelete(null);
    }
  };

  const handleAdd = async () => {
    const predicate = draft.predicate.trim();
    const object    = draft.object.trim();
    if (!predicate || !object) return;
    setWriteError(null);
    try {
      await sendJson("POST", "/api/drawer/facts", {
        chatId,
        subjectId:     characterId,
        predicate,
        objectLiteral: object,
      });
      setDraft({ predicate: "", object: "" });
      setAdding(false);
      bumpExtraction();
    } catch (e) {
      setWriteError(e instanceof Error ? e.message : String(e));
    }
  };

  // Separate live from superseded for the history view
  const liveFacts       = facts.filter((f) => f.tValidEnd === null);
  const supersededFacts = facts.filter((f) => f.tValidEnd !== null);

  // Build a map: supersededBy fact ID → the fact(s) it replaced
  const predecessors = new Map<number, DrawerFact[]>();
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
      {writeError && (
        <div className="flex items-start gap-1.5 text-[10px] text-red-600 bg-red-50 rounded p-2">
          <span className="flex-1">{writeError}</span>
          <button onClick={() => setWriteError(null)} className="cursor-pointer flex-shrink-0">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Add a fact by hand — extraction misses things, and corrections need
          to outrank incidental output (the route stores them at high importance). */}
      {adding ? (
        <div className="rounded-lg border border-[var(--purple)] bg-white p-2 space-y-1.5">
          <Input
            value={draft.predicate}
            onChange={(e) => setDraft((d) => ({ ...d, predicate: e.target.value }))}
            placeholder="predicate — e.g. works_at, fears, sibling_of"
            className="h-7 text-[11px]"
            autoFocus
          />
          <Input
            value={draft.object}
            onChange={(e) => setDraft((d) => ({ ...d, object: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            placeholder="value — e.g. the dive coffee shop"
            className="h-7 text-[11px]"
          />
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              className="h-6 text-[10px]"
              onClick={handleAdd}
              disabled={!draft.predicate.trim() || !draft.object.trim()}
            >
              Add fact
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px]"
              onClick={() => { setAdding(false); setDraft({ predicate: "", object: "" }); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full flex items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--border)] py-1.5 text-[10px] text-[var(--muted-fg)] hover:border-[var(--purple)] hover:text-[var(--purple-fg)] transition-colors cursor-pointer"
        >
          <Plus className="h-3 w-3" />
          Add a fact
        </button>
      )}

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
            <div key={f.id} className="group rounded-lg border border-[var(--border)] bg-white p-2.5">
              <div className="flex items-start gap-1.5">
                <p className="flex-1 min-w-0 text-[11px] text-[var(--foreground)] leading-snug">
                  <span className="font-medium text-[var(--purple-fg)]">{f.predicate}</span>
                  {" "}
                  <span>{f.objectDisplay}</span>
                </p>
                <button
                  onClick={() => (confirmDelete === f.id ? handleDelete(f.id) : setConfirmDelete(f.id))}
                  onBlur={() => setConfirmDelete((v) => (v === f.id ? null : v))}
                  disabled={busyId === f.id}
                  title={confirmDelete === f.id ? "Click again to delete this fact" : "Delete — the character forgets this"}
                  className={`flex-shrink-0 rounded p-1 transition-all cursor-pointer ${
                    confirmDelete === f.id
                      ? "text-red-500 bg-red-50 opacity-100"
                      : "text-[var(--muted-fg)] opacity-0 group-hover:opacity-100 hover:text-red-500"
                  }`}
                >
                  {busyId === f.id
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Trash2 className="h-3 w-3" />}
                </button>
              </div>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {f.confidence < 1.0 && (
                  <Badge variant="default">{Math.round(f.confidence * 100)}%</Badge>
                )}
                <span className="text-[10px] text-[var(--muted-fg)]">
                  {formatAgeFromUnixSeconds(f.tValidStart)}
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
                          {formatDateFromUnixSeconds(old.tValidStart)} → {old.tValidEnd ? formatDateFromUnixSeconds(old.tValidEnd) : "?"}
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
                      {formatDateFromUnixSeconds(f.tValidStart)} → {f.tValidEnd ? formatDateFromUnixSeconds(f.tValidEnd) : "?"}
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

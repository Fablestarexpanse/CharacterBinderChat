"use client";

import { useState, useEffect } from "react";
import { Loader2, AlertTriangle, GitMerge } from "lucide-react";
import { getJson } from "@/lib/api/client";

interface EntityOverview {
  id:          string;
  type:        string;
  name:        string;
  description: string;
  factCount:   number;
}

interface OverviewResponse {
  entities:           EntityOverview[];
  possibleDuplicates: string[][];
  error?:             string;
}

const TYPE_COLORS: Record<string, string> = {
  character: "var(--purple-fg)",
  place:     "#22c55e",
  object:    "#f97316",
  faction:   "#4f9cf8",
  concept:   "#a78bfa",
};

interface Props {
  chatId:            string;
  extractionVersion: number;
}

export function EntitiesView({ chatId, extractionVersion }: Props) {
  // Result keyed by what was fetched; `loading` is derived so the effect
  // never calls setState synchronously (react-hooks/set-state-in-effect).
  // `refreshTick` triggers a refetch after a merge.
  const [refreshTick, setRefreshTick] = useState(0);
  const [result, setResult] = useState<{ key: string; data: OverviewResponse | null; error: string | null } | null>(null);

  // Merge UI state: { clusterId → { confirmingMerge: boolean, fromId, toId } }
  const [mergeState, setMergeState] = useState<
    Record<string, { confirming: boolean; fromId: string; toId: string; merging: boolean; done: boolean }>
  >({});
  const [mergeError, setMergeError] = useState<string | null>(null);

  const fetchKey = `${chatId}:${extractionVersion}:${refreshTick}`;

  useEffect(() => {
    let cancelled = false;
    const key = `${chatId}:${extractionVersion}:${refreshTick}`;
    getJson<OverviewResponse>(`/api/drawer/entities/overview?chatId=${encodeURIComponent(chatId)}`)
      .then((d) => { if (!cancelled) setResult({ key, data: d, error: null }); })
      .catch((e: Error) => { if (!cancelled) setResult({ key, data: null, error: e.message }); });
    return () => { cancelled = true; };
  }, [chatId, extractionVersion, refreshTick]);

  const loading = result?.key !== fetchKey;
  const data    = result?.data ?? null;
  const error   = mergeError ?? result?.error ?? null;

  const handleMergeClick = (clusterId: string, cluster: string[]) => {
    // Default: merge smaller-id into larger-id (first alpha → second)
    const [fromId, toId] = [cluster[0], cluster[cluster.length - 1]];
    setMergeState((prev) => ({
      ...prev,
      [clusterId]: { confirming: true, fromId, toId, merging: false, done: false },
    }));
  };

  const handleMergeConfirm = async (clusterId: string) => {
    const ms = mergeState[clusterId];
    if (!ms) return;
    setMergeState((prev) => ({ ...prev, [clusterId]: { ...ms, merging: true } }));
    try {
      const res = await fetch("/api/drawer/entities/merge", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ chatId, fromId: ms.fromId, toId: ms.toId }),
      });
      const result = await res.json() as { ok?: boolean; error?: string };
      if (!result.ok) throw new Error(result.error ?? "Merge failed");
      setMergeState((prev) => ({ ...prev, [clusterId]: { ...ms, merging: false, done: true, confirming: false } }));
      // Refresh to reflect the merge
      setRefreshTick((t) => t + 1);
    } catch (e) {
      setMergeError(String(e));
      setMergeState((prev) => ({ ...prev, [clusterId]: { ...ms, merging: false } }));
    }
  };

  const handleMergeCancel = (clusterId: string) => {
    setMergeState((prev) => {
      const next = { ...prev };
      delete next[clusterId];
      return next;
    });
  };

  if (loading && !data) {
    return (
      <div className="flex items-center gap-1.5 text-[var(--muted-fg)] py-2">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="text-[11px]">Loading…</span>
      </div>
    );
  }

  if (error) {
    return <div className="text-[10px] text-red-500 bg-red-50 rounded p-2">{error}</div>;
  }

  if (!data) return null;

  const { entities, possibleDuplicates } = data;
  const entityMap = new Map(entities.map((e) => [e.id, e]));

  return (
    <div className="space-y-3">

      {/* Duplicate callout */}
      {possibleDuplicates.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
            <span className="text-[11px] font-semibold text-amber-800">
              Possible duplicate entities
            </span>
          </div>

          {possibleDuplicates.map((cluster) => {
            const clusterId = cluster.join("_");
            const ms = mergeState[clusterId];
            const names = cluster.map((id) => entityMap.get(id)?.name ?? id);

            return (
              <div key={clusterId} className="rounded border border-amber-200 bg-white p-2.5 space-y-1.5">
                <div className="text-[10px] text-amber-800 font-medium">
                  {cluster.map((id, i) => (
                    <span key={id}>
                      <code className="bg-amber-100 px-1 rounded">{id}</code>
                      {i < cluster.length - 1 && <span className="mx-1 text-amber-400">·</span>}
                    </span>
                  ))}
                  {names[0] !== cluster[0] && (
                    <span className="ml-1.5 text-amber-600">&quot;{names[0]}&quot;</span>
                  )}
                </div>

                {/* Merge controls */}
                {!ms ? (
                  <button
                    onClick={() => handleMergeClick(clusterId, cluster)}
                    className="flex items-center gap-1 text-[10px] text-amber-700 hover:text-amber-900 transition-colors"
                  >
                    <GitMerge className="h-3 w-3" />
                    Merge…
                  </button>
                ) : ms.done ? (
                  <span className="text-[10px] text-green-600">✓ Merged</span>
                ) : ms.confirming && !ms.merging ? (
                  <div className="space-y-1.5">
                    <div className="text-[10px] text-amber-900 leading-snug">
                      Merge <code className="bg-amber-100 px-0.5 rounded">{ms.fromId}</code> into{" "}
                      <code className="bg-amber-100 px-0.5 rounded">{ms.toId}</code>?
                      <br />
                      <span className="text-amber-700">This rewrites all facts, stats, and commitments. Cannot be undone.</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleMergeConfirm(clusterId)}
                        className="text-[10px] bg-amber-600 text-white px-2 py-0.5 rounded hover:bg-amber-700 transition-colors"
                      >
                        Confirm merge
                      </button>
                      <button
                        onClick={() => handleMergeCancel(clusterId)}
                        className="text-[10px] text-[var(--muted-fg)] hover:text-[var(--foreground)] transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-[10px] text-amber-700">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Merging…
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Entity list */}
      {entities.length === 0 ? (
        <div className="text-[11px] text-[var(--muted-fg)] italic">
          No entities in the knowledge graph yet.
        </div>
      ) : (
        <div className="space-y-1.5">
          {entities.map((e) => (
            <div
              key={e.id}
              className="rounded-lg border border-[var(--border)] bg-white p-2.5 flex items-start justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border"
                    style={{
                      color:            TYPE_COLORS[e.type] ?? "var(--muted-fg)",
                      borderColor:      TYPE_COLORS[e.type] ?? "var(--border)",
                      backgroundColor:  TYPE_COLORS[e.type] ? `${TYPE_COLORS[e.type]}18` : "transparent",
                    }}
                  >
                    {e.type}
                  </span>
                  <span className="text-[11px] font-medium text-[var(--foreground)]">{e.name}</span>
                </div>
                <div className="text-[10px] text-[var(--muted-fg)] mt-0.5 font-mono">{e.id}</div>
                {e.description && (
                  <div className="text-[10px] text-[var(--muted-fg)] mt-0.5 leading-snug truncate">
                    {e.description}
                  </div>
                )}
              </div>
              <div className="flex-shrink-0 text-[10px] text-[var(--muted-fg)] tabular-nums">
                {e.factCount > 0 && (
                  <span className="bg-[var(--muted)] px-1.5 py-0.5 rounded-full">{e.factCount} fact{e.factCount !== 1 ? "s" : ""}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

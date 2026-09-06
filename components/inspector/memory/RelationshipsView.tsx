"use client";

import { useState, useEffect } from "react";
import { Loader2, Heart, Shield, Flame, Link2, CloudSun } from "lucide-react";
import { formatAgeFromUnixSeconds } from "./utils";
import { getJson } from "@/lib/api/client";
import type { StatName } from "@/lib/db/models";

interface StatRow {
  name:        StatName;
  value:       number | null;
  decayRate:   number | null;
  lastUpdated: number | null;
}

const STAT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  affection:  Heart,
  trust:      Shield,
  desire:     Flame,
  connection: Link2,
  mood:       CloudSun,
};

const STAT_COLORS: Record<string, string> = {
  affection:  "#e879a0",
  trust:      "#4f9cf8",
  desire:     "#f97316",
  connection: "#8b5cf6",
  mood:       "#22d3ee",
};

interface Props {
  chatId:            string;
  characterId:       string;
  extractionVersion: number;
}

export function RelationshipsView({ chatId, characterId, extractionVersion }: Props) {
  // Single result object keyed by what was fetched; `loading` is derived so
  // the effect never calls setState synchronously (react-hooks/set-state-in-effect).
  const [result, setResult] = useState<{ key: string; stats: StatRow[]; error: string | null } | null>(null);

  const fetchKey = `${chatId}:${characterId}:${extractionVersion}`;

  useEffect(() => {
    let cancelled = false;
    const key = `${chatId}:${characterId}:${extractionVersion}`;
    // character → player: how this character feels about the user
    getJson<{ stats?: StatRow[] }>(
      `/api/drawer/stats?chatId=${encodeURIComponent(chatId)}&observer=${encodeURIComponent(characterId)}&target=player`
    )
      .then((data) => { if (!cancelled) setResult({ key, stats: data.stats ?? [], error: null }); })
      .catch((e: Error) => { if (!cancelled) setResult({ key, stats: [], error: e.message }); });
    return () => { cancelled = true; };
  }, [chatId, characterId, extractionVersion]);

  const loading = result?.key !== fetchKey;
  const stats   = result?.stats ?? [];
  const error   = result?.error ?? null;

  if (loading) {
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

  const hasAnyValue = stats.some((s) => s.value !== null);

  if (!hasAnyValue) {
    return (
      <div className="text-[11px] text-[var(--muted-fg)] italic">
        No relationship stats recorded yet. Stats update automatically as the story develops.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {stats.map((s) => {
        const Icon  = STAT_ICONS[s.name] ?? Heart;
        const color = STAT_COLORS[s.name] ?? "#8b5cf6";
        // Stats are −100..100; map to 0..100% so negatives don't render empty
        // (same mapping as CharacterTab / SummaryTab).
        const pct   = s.value !== null ? Math.max(0, Math.min(100, ((s.value + 100) / 200) * 100)) : 0;
        return (
          <div key={s.name}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <span style={{ color }}>
                  <Icon className="h-3 w-3" />
                </span>
                <span className="text-[11px] font-medium text-[var(--foreground)] capitalize">
                  {s.name}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {s.value !== null ? (
                  <span className="text-[10px] tabular-nums text-[var(--foreground)] font-medium">
                    {s.value >= 0 ? "+" : ""}{Math.round(s.value)}
                  </span>
                ) : (
                  <span className="text-[10px] text-[var(--muted-fg)]">unset</span>
                )}
                {s.lastUpdated !== null && (
                  <span className="text-[9px] text-[var(--muted-fg)]">
                    {formatAgeFromUnixSeconds(s.lastUpdated)}
                  </span>
                )}
              </div>
            </div>
            {s.value !== null ? (
              <div className="h-1.5 w-full rounded-full bg-[var(--border)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
            ) : (
              <div className="h-1.5 w-full rounded-full bg-[var(--border)]" />
            )}
            {s.decayRate !== null && (
              <div className="mt-0.5 text-[9px] text-[var(--muted-fg)]">
                decay {(s.decayRate * 100).toFixed(0)}%/wk
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

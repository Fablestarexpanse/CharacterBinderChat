"use client";

import { useState, useEffect } from "react";
import { Loader2, Heart, Shield, Flame, Link2, CloudSun } from "lucide-react";
import { formatRelativeTime } from "./utils";

interface StatRow {
  name:        string;
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
  characterId:       string;
  extractionVersion: number;
}

export function RelationshipsView({ characterId, extractionVersion }: Props) {
  const [stats,   setStats]   = useState<StatRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    // Fetch player → character direction (the primary "how does the character feel about the user")
    fetch(`/api/drawer/stats?observer=player&target=${encodeURIComponent(characterId)}`)
      .then((r) => r.json())
      .then((data: { stats?: StatRow[]; error?: string }) => {
        if (data.error) throw new Error(data.error);
        setStats(data.stats ?? []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [characterId, extractionVersion]);

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
        const pct   = s.value !== null ? Math.max(0, Math.min(100, s.value)) : 0;
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
                    {Math.round(s.value)}
                  </span>
                ) : (
                  <span className="text-[10px] text-[var(--muted-fg)]">unset</span>
                )}
                {s.lastUpdated !== null && (
                  <span className="text-[9px] text-[var(--muted-fg)]">
                    {formatRelativeTime(s.lastUpdated)}
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

"use client";

import { useEffect, useState } from "react";
import { useFableStore } from "@/lib/store";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Edit2, Heart, Shield, Flame, Link2, CloudSun } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StatRow {
  name:        string;
  value:       number | null;
  decayRate:   number | null;
  lastUpdated: number | null;
}

interface RelationshipGroup {
  targetId:   string;
  targetName: string;
  stats:      Array<{ name: string; value: number; decayRate: number }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function StatBar({ name, value }: { name: string; value: number }) {
  const Icon    = STAT_ICONS[name] ?? Heart;
  const color   = STAT_COLORS[name] ?? "#7c5cbf";
  const pct     = Math.min(100, Math.max(0, ((value + 100) / 200) * 100));
  const display = value >= 0 ? `+${value.toFixed(0)}` : value.toFixed(0);

  return (
    <div className="flex items-center gap-2">
      <span style={{ color }} className="flex-shrink-0 leading-none">
        <Icon className="h-3 w-3" />
      </span>
      <span className="text-[11px] text-[var(--muted-fg)] w-16 flex-shrink-0 capitalize">{name}</span>
      <div className="flex-1 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[11px] font-mono text-[var(--foreground)] w-8 text-right flex-shrink-0">
        {display}
      </span>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CharacterTab() {
  const { activeChatId, chats, characters, extractionVersion, openCharacterEditor, setActiveSection } = useFableStore();
  const chat      = chats.find((c) => c.id === activeChatId);
  const character = characters.find((c) => c.id === chat?.characterId);

  const [relationships, setRelationships] = useState<RelationshipGroup[]>([]);
  const [stats, setStats]                 = useState<StatRow[]>([]);

  const characterId = character?.id;

  useEffect(() => {
    if (!characterId) return;

    // Fetch summary (which includes relationships + stats)
    fetch(`/api/drawer/summary/${encodeURIComponent(characterId)}`)
      .then((r) => r.json())
      .then((data: { relationships?: RelationshipGroup[] }) => {
        setRelationships(data.relationships ?? []);
      })
      .catch(() => {/* silently ignore */});

    // Fetch stats against "player" as a default observer pair
    fetch(`/api/drawer/stats?observer=player&target=${encodeURIComponent(characterId)}`)
      .then((r) => r.json())
      .then((data: { stats?: StatRow[] }) => setStats(data.stats ?? []))
      .catch(() => {/* silently ignore */});
  }, [characterId, extractionVersion]);

  if (!character) {
    return (
      <div className="p-4 text-center text-sm text-[var(--muted-fg)]">
        No character assigned to this chat.
      </div>
    );
  }

  // Find the "player → character" stat row for display
  const playerStats = stats.filter((s) => s.value !== null) as Array<StatRow & { value: number }>;

  return (
    <div className="p-4 space-y-4">
      {/* Portrait */}
      <div className="flex flex-col items-center gap-3">
        <Avatar name={character.name} src={character.avatar} size="lg" />
        <div className="text-center">
          <div className="font-semibold text-[var(--foreground)]">{character.name}</div>
        </div>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1">
        {character.tags.map((tag) => (
          <Badge key={tag} variant="purple">{tag}</Badge>
        ))}
      </div>

      {/* Description */}
      <div>
        <div className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider mb-1.5">
          Description
        </div>
        <p className="text-xs text-[var(--foreground)] leading-relaxed">{character.description}</p>
      </div>

      {/* Personality */}
      {character.personality && (
        <div>
          <div className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider mb-1.5">
            Personality
          </div>
          <p className="text-xs text-[var(--foreground)] leading-relaxed">{character.personality}</p>
        </div>
      )}

      {/* Relationship stats — player → character */}
      {playerStats.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider mb-2">
            Relationship Stats
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-white p-3 space-y-2">
            {playerStats.map((s) => (
              <StatBar key={s.name} name={s.name} value={s.value} />
            ))}
          </div>
        </div>
      )}

      {/* All relationships extracted from conversation */}
      {relationships.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider mb-2">
            Known Relationships
          </div>
          <div className="space-y-2">
            {relationships.map((rel) => (
              <div
                key={rel.targetId}
                className="rounded-lg border border-[var(--border)] bg-white p-3"
              >
                <div className="text-xs font-medium text-[var(--foreground)] mb-2">
                  → {rel.targetName}
                </div>
                <div className="space-y-1.5">
                  {rel.stats.map((s) => (
                    <StatBar key={s.name} name={s.name} value={s.value} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={() => openCharacterEditor(character.id)}>
          <Edit2 className="h-3 w-3 mr-1.5" />
          Edit
        </Button>
        <Button variant="outline" size="sm" className="flex-1" onClick={() => setActiveSection("characters")}>
          <ExternalLink className="h-3 w-3 mr-1.5" />
          Full Profile
        </Button>
      </div>
    </div>
  );
}

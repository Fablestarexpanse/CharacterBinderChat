"use client";

import { useEffect, useState } from "react";
import { useFableStore } from "@/lib/store";
import { useInspectedCharacter } from "@/lib/hooks/useInspectedCharacter";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Section } from "./Section";
import { ExternalLink, Edit2, Heart, Shield, Flame, Link2, CloudSun, UserRound, ChevronDown, Check } from "lucide-react";

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
  const { activeChatId, extractionVersion, openCharacterEditor, setActiveSection, personas, activePersonaId, setActivePersona } =
    useFableStore();
  const { character } = useInspectedCharacter();
  const persona = personas.find((p) => p.id === activePersonaId);
  const [personaPickerOpen, setPersonaPickerOpen] = useState(false);

  const [relationships, setRelationships] = useState<RelationshipGroup[]>([]);
  const [stats, setStats]                 = useState<StatRow[]>([]);

  const characterId = character?.id;

  useEffect(() => {
    if (!characterId || !activeChatId) return;
    const chatParam = `chatId=${encodeURIComponent(activeChatId)}`;
    // Cancelled guard: without it, rapid chat switching let the older chat's
    // slower response resolve last and display the wrong chat's stats.
    let cancelled = false;

    // Fetch summary (which includes relationships + stats)
    fetch(`/api/drawer/summary/${encodeURIComponent(characterId)}?${chatParam}`)
      .then((r) => r.json())
      .then((data: { relationships?: RelationshipGroup[] }) => {
        if (!cancelled) setRelationships(data.relationships ?? []);
      })
      .catch(() => {/* silently ignore */});

    // character -> player: how this character feels about the user
    fetch(`/api/drawer/stats?${chatParam}&observer=${encodeURIComponent(characterId)}&target=player`)
      .then((r) => r.json())
      .then((data: { stats?: StatRow[] }) => {
        if (!cancelled) setStats(data.stats ?? []);
      })
      .catch(() => {/* silently ignore */});

    return () => { cancelled = true; };
  }, [characterId, activeChatId, extractionVersion]);

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
    <div className="p-3 space-y-3">
      {/* Who's in the scene: the character... */}
      <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-white p-3">
        <Avatar name={character.name} src={character.avatar} size="md" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-[var(--foreground)] truncate">{character.name}</div>
          {character.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {character.tags.slice(0, 4).map((tag) => (
                <Badge key={tag} variant="purple">{tag}</Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ...and you (the active persona) — click to switch to any saved one */}
      <div className="rounded-lg border border-[var(--border)] bg-white overflow-hidden">
        <button
          onClick={() => setPersonaPickerOpen((v) => !v)}
          title="Switch persona"
          className="w-full flex items-center gap-3 p-3 text-left hover:bg-[var(--muted)] transition-colors cursor-pointer"
        >
          {persona
            ? <Avatar name={persona.name} src={persona.avatar} size="md" />
            : <div className="h-10 w-10 rounded-full bg-[var(--muted)] flex items-center justify-center flex-shrink-0">
                <UserRound className="h-5 w-5 text-[var(--muted-fg)]" />
              </div>}
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-fg)]">You are</div>
            <div className="text-sm font-semibold text-[var(--foreground)] truncate">
              {persona?.name ?? "No persona selected"}
            </div>
            {persona?.description && (
              <p className="text-[11px] text-[var(--muted-fg)] leading-snug line-clamp-2 mt-0.5">
                {persona.description}
              </p>
            )}
          </div>
          <ChevronDown
            className={`h-3.5 w-3.5 text-[var(--muted-fg)] flex-shrink-0 transition-transform ${personaPickerOpen ? "rotate-180" : ""}`}
          />
        </button>
        {personaPickerOpen && (
          <div className="border-t border-[var(--border)] p-1.5 space-y-0.5">
            {personas.map((p) => {
              const active = p.id === persona?.id;
              return (
                <button
                  key={p.id}
                  onClick={() => { setActivePersona(p.id); setPersonaPickerOpen(false); }}
                  className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors cursor-pointer ${
                    active
                      ? "bg-[var(--purple-light)] text-[var(--purple-fg)]"
                      : "hover:bg-[var(--muted)] text-[var(--foreground)]"
                  }`}
                >
                  <Avatar name={p.name} src={p.avatar} size="xs" />
                  <span className="flex-1 min-w-0 text-xs font-medium truncate">{p.name}</span>
                  {active && <Check className="h-3 w-3 flex-shrink-0" />}
                </button>
              );
            })}
            <button
              onClick={() => setActiveSection("characters")}
              className="w-full rounded-md px-2 py-1.5 text-left text-xs text-[var(--muted-fg)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
            >
              + Manage personas…
            </button>
          </div>
        )}
      </div>

      {/* What the memory system is tracking — the reason this tab exists */}
      {playerStats.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-[var(--muted-fg)] uppercase tracking-wider mb-2">
            How {character.name} feels about you
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

      {/* The full sheet stays a click away instead of flooding the panel */}
      <Section title="Character sheet" defaultOpen={false}>
        <div className="space-y-2">
          <p className="text-[11px] text-[var(--foreground)] leading-relaxed whitespace-pre-wrap">
            {character.description}
          </p>
          {character.personality && (
            <>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-fg)] pt-1">
                Personality
              </div>
              <p className="text-[11px] text-[var(--foreground)] leading-relaxed whitespace-pre-wrap">
                {character.personality}
              </p>
            </>
          )}
        </div>
      </Section>

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

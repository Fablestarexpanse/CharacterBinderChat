"use client";

import { useEffect, useState } from "react";
import { useFableStore } from "@/lib/store";
import { useInspectedCharacter } from "@/lib/hooks/useInspectedCharacter";
import { Brain, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "./Section";
import type { CoreMemory } from "@/lib/db/models";
import type { CoreMemoryGetResponse } from "@/lib/api/dto";
import { resolveRouteCredentials } from "@/lib/providers/factory";
import { getJson, sendJson } from "@/lib/api/client";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * One labelled bar. `range` rescales a value onto 0..100 for the fill — the
 * VAD mood axes run -1..1 or 0..1 while the relationship stats are already a
 * percentage — and `format` decides what the number beside it reads as.
 *
 * This was two byte-identical components differing only in those two details.
 */
function Bar({
  label,
  value,
  range = [0, 100],
  format = (v: number) => String(Math.round(v)),
}: {
  label:   string;
  value:   number;
  range?:  [number, number];
  format?: (value: number) => string;
}) {
  const [min, max] = range;
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const color =
    pct > 65 ? "bg-green-500" :
    pct < 35 ? "bg-red-400"   :
               "bg-[var(--purple)]";

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-[var(--muted-fg)] w-20 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] tabular-nums text-[var(--muted-fg)] w-8 text-right">
        {format(value)}
      </span>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CoreMemoryTab() {
  const { extractionVersion, providerSettings } = useFableStore();
  const { chat, character } = useInspectedCharacter();

  // Result keyed by what was fetched; `loading` is derived so the effect
  // never calls setState synchronously. relAge is computed at fetch time
  // (Date.now() is impure during render). `refreshTick` re-fetches after an
  // LLM rewrite.
  interface MemoryResult {
    key:     string;
    cm:      CoreMemory | null;
    version: number | null;
    relAge:  string | null;
    error:   string | null;
  }
  const [refreshTick,  setRefreshTick]  = useState(0);
  const [result,       setResult]       = useState<MemoryResult | null>(null);
  const [refreshing,   setRefreshing]   = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const characterId   = character?.id;
  const characterName = character?.name;
  const chatId        = chat?.id;
  const fetchKey      = `${chatId}:${characterId}:${extractionVersion}:${refreshTick}`;

  useEffect(() => {
    if (!chatId || !characterId || !characterName) return;
    let cancelled = false;
    const key = `${chatId}:${characterId}:${extractionVersion}:${refreshTick}`;
    (async () => {
      try {
        const data = await getJson<CoreMemoryGetResponse>(
          `/api/chat/core-memory?chatId=${encodeURIComponent(chatId)}&characterId=${encodeURIComponent(characterId)}&name=${encodeURIComponent(characterName)}`
        );
        if (cancelled) return;
        const relAge = data.updatedAt
          ? Math.round((Date.now() / 1000 - data.updatedAt) / 60) + "m ago"
          : null;
        setResult({ key, cm: data.coreMemory, version: data.version, relAge, error: null });
      } catch (e) {
        if (!cancelled) {
          setResult({
            key, cm: null, version: null, relAge: null,
            error: e instanceof Error ? e.message : "Failed to load core memory",
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [chatId, characterId, characterName, extractionVersion, refreshTick]);

  const loading = !!characterId && result?.key !== fetchKey;
  const cm      = result?.cm ?? null;
  const version = result?.version ?? null;
  const relAge  = result?.relAge ?? null;
  const error   = refreshError ?? result?.error ?? null;

  const handleRefresh = async () => {
    if (!character || !chat) return;
    setRefreshing(true);
    setRefreshError(null);

    const { providerType, providerBaseUrl, apiKey } =
      resolveRouteCredentials(chat.providerId, providerSettings);

    try {
      // sendJson throws on a non-2xx or an error envelope — an unchecked
      // failure here used to spin, silently re-fetch the unchanged memory,
      // and report nothing.
      await sendJson("POST", "/api/chat/core-memory/refresh", {
        chatId:          chat.id,
        characterId:     character.id,
        characterName:   character.name,
        messages:        chat.messages.slice(-16).map((m) => ({ role: m.role, content: m.content })),
        providerType,
        providerBaseUrl,
        modelId:         chat.modelId ?? "llama3.2:latest",
        apiKey,
      });
      setRefreshTick((t) => t + 1); // re-fetch the rewritten memory
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  if (!character) {
    return (
      <div className="p-4 text-[12px] text-[var(--muted-fg)] text-center">
        No character assigned to this chat.
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Brain className="h-3.5 w-3.5 text-[var(--purple-fg)]" />
          <span className="text-[11px] font-semibold text-[var(--foreground)]">Core Memory</span>
          {version !== null && (
            <span className="text-[10px] text-[var(--muted-fg)]">v{version}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {relAge && <span className="text-[10px] text-[var(--muted-fg)]">{relAge}</span>}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Rewrite core memory with LLM"
            onClick={handleRefresh}
            disabled={refreshing || loading}
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {error && (
        <div className="text-[10px] text-red-500 bg-red-50 rounded px-2 py-1">{error}</div>
      )}

      {loading && !cm && (
        <div className="text-[11px] text-[var(--muted-fg)] text-center py-4">Loading…</div>
      )}

      {cm && (
        <div className="space-y-2">

          {/* Tracked stats lead; prose folds below them */}
          <Section title="Relationship with User">
            <Bar label="Affection"  value={cm.relationship_with_user.affection} />
            <Bar label="Trust"      value={cm.relationship_with_user.trust} />
            <Bar label="Desire"     value={cm.relationship_with_user.desire} />
            <Bar label="Connection" value={cm.relationship_with_user.connection} />
            <Bar label="Mood"       value={cm.relationship_with_user.mood} />
          </Section>

          {/* Mood */}
          <Section title="Mood (VAD)">
            <Bar label="Valence"   value={cm.mood.valence}   range={[-1, 1]} format={(v) => v.toFixed(2)} />
            <Bar label="Arousal"   value={cm.mood.arousal}   range={[0, 1]}  format={(v) => v.toFixed(2)} />
            <Bar label="Dominance" value={cm.mood.dominance} range={[0, 1]}  format={(v) => v.toFixed(2)} />
          </Section>

          {/* Persona */}
          <Section title="Self-Image" defaultOpen={false}>
            <p className="text-[11px] text-[var(--foreground)] leading-relaxed">
              {cm.persona || <span className="text-[var(--muted-fg)] italic">No persona set.</span>}
            </p>
          </Section>

          {/* Narrative */}
          <Section title="Narrative Summary">
            <p className="text-[11px] text-[var(--foreground)] leading-relaxed">
              {cm.narrative_summary || <span className="text-[var(--muted-fg)] italic">No narrative yet.</span>}
            </p>
          </Section>

          {/* Internal Thoughts */}
          {cm.internal_thoughts.length > 0 && (
            <Section title="Internal Thoughts" defaultOpen={false}>
              <ul className="space-y-1">
                {cm.internal_thoughts.map((t, i) => (
                  <li key={i} className="text-[11px] text-[var(--foreground)] leading-snug">
                    <span className="text-[var(--muted-fg)] mr-1">–</span>{t}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Commitments */}
          {cm.active_commitments.length > 0 && (
            <Section title="Active Commitments" defaultOpen={false}>
              <ul className="space-y-1">
                {cm.active_commitments.map((c, i) => (
                  <li key={i} className="text-[11px] text-[var(--foreground)] leading-snug">
                    <span className="text-[var(--muted-fg)] mr-1">•</span>{c}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Emotional Events */}
          {cm.recent_emotional_events.length > 0 && (
            <Section title="Recent Emotional Events" defaultOpen={false}>
              <ul className="space-y-1.5">
                {cm.recent_emotional_events.map((e, i) => {
                  const icon =
                    e.impact === "positive" ? "+" :
                    e.impact === "negative" ? "-" :
                    "~";
                  const color =
                    e.impact === "positive" ? "text-green-600" :
                    e.impact === "negative" ? "text-red-500" :
                    "text-[var(--muted-fg)]";
                  return (
                    <li key={i} className="flex gap-1.5">
                      <span className={`${color} font-bold text-[11px] flex-shrink-0`}>{icon}</span>
                      <span className="text-[11px] text-[var(--foreground)] leading-snug">{e.description}</span>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

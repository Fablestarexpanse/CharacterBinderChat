// ─── Memory Update Helpers ────────────────────────────────────────────────────
// Thin, named helpers for updating the Core Memory Block from API routes.
// Server-side only.

import { getStore } from "@/lib/db";
import type { StatName } from "@/lib/db/models";
import { addEmotionalEvent, setInternalThoughts, syncStatsToCore } from "@/lib/chat/coreMemoryStore";

// ─── Stat updaters ────────────────────────────────────────────────────────────

/**
 * Update a Drawer-2 relationship stat and sync it back into Core Memory.
 * `delta` is additive (positive or negative).
 */
export function updateStat(
  characterId: string,
  stat:        StatName,
  delta:       number,
  observerId   = "player"
): void {
  const store = getStore();
  store.ensureEntity(characterId, "character", characterId);
  store.ensureEntity(observerId,  "character", observerId);
  store.deltaStat(observerId, characterId, stat, delta);
  syncStatsToCore(characterId);
}

// ─── Mood updaters ────────────────────────────────────────────────────────────

/**
 * Set the mood (valence/arousal/dominance) in Core Memory directly.
 * Values are clamped to their valid ranges.
 */
export function setMood(
  characterId: string,
  mood: { valence?: number; arousal?: number; dominance?: number }
): void {
  const store    = getStore();
  const existing = store.getCoreMemory(characterId);
  if (!existing) return;

  const current = existing.data.mood;
  store.patchCoreMemory(characterId, {
    mood: {
      valence:   Math.max(-1, Math.min(1, mood.valence   ?? current.valence)),
      arousal:   Math.max(0,  Math.min(1, mood.arousal   ?? current.arousal)),
      dominance: Math.max(0,  Math.min(1, mood.dominance ?? current.dominance)),
    },
  });
}

// ─── Commitment updaters ──────────────────────────────────────────────────────

/**
 * Add a commitment to both Drawer-2 (SQLite commitments table)
 * and the Core Memory Block active_commitments list.
 */
export function addCommitment(
  characterId:  string,
  description:  string,
  promiseeId?:  string
): void {
  const store = getStore();
  store.ensureEntity(characterId, "character", characterId);
  store.insertCommitment(characterId, description, promiseeId);

  // Mirror into Core Memory (keep max 8 active)
  const existing = store.getCoreMemory(characterId);
  if (!existing) return;
  const updated = [description, ...(existing.data.active_commitments ?? [])].slice(0, 8);
  store.patchCoreMemory(characterId, { active_commitments: updated });
}

/**
 * Remove a commitment by exact description match from Core Memory.
 * (Drawer-2 commitments are never deleted — they're resolved via status.)
 */
export function removeCommitment(characterId: string, description: string): void {
  const store    = getStore();
  const existing = store.getCoreMemory(characterId);
  if (!existing) return;
  const updated  = (existing.data.active_commitments ?? []).filter((c) => c !== description);
  store.patchCoreMemory(characterId, { active_commitments: updated });
}

// ─── Emotional event recorder ─────────────────────────────────────────────────

/**
 * Record a significant emotional event in Core Memory.
 * intensity: 0 (minor) to 1 (life-altering).
 */
export function recordEmotionalEvent(
  characterId: string,
  description: string,
  impact:      "positive" | "negative" | "neutral" = "neutral",
  intensity    = 0.5
): void {
  addEmotionalEvent(characterId, { description, impact, intensity });
}

// ─── Internal thought setter ──────────────────────────────────────────────────

export { setInternalThoughts };

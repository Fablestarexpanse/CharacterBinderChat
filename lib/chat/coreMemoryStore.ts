// ─── Core Memory Store (Drawer 1) ─────────────────────────────────────────────
// Server-side only. Thin wrappers around FableStore for Core Memory operations.
// Import from API routes; do NOT import in client components.

import { getStore } from "@/lib/db";
import type { CoreMemory, DbCoreMemory, EmotionalEvent } from "@/lib/db/models";

// ─── Read ─────────────────────────────────────────────────────────────────────

export function getCoreMemory(characterId: string): DbCoreMemory | null {
  return getStore().getCoreMemory(characterId);
}

export function ensureCoreMemory(
  characterId:   string,
  characterName: string
): DbCoreMemory {
  return getStore().ensureCoreMemory(characterId, characterName);
}

// ─── Write ────────────────────────────────────────────────────────────────────

export function setCoreMemory(cm: CoreMemory): void {
  getStore().setCoreMemory(cm);
}

export function patchCoreMemory(
  characterId: string,
  patch:       Partial<CoreMemory>
): DbCoreMemory | null {
  return getStore().patchCoreMemory(characterId, patch);
}

// ─── Convenience updaters ─────────────────────────────────────────────────────

/** Merge new Drawer-2 stats into the core memory relationship block */
export function syncStatsToCore(characterId: string): void {
  const store    = getStore();
  const existing = store.getCoreMemory(characterId);
  if (!existing) return;

  const stats = store.queryStats("player", characterId);
  const rel   = { ...existing.data.relationship_with_user };

  for (const [statName, row] of Object.entries(stats)) {
    if (row) {
      (rel as Record<string, number>)[statName] = Math.round(row.value);
    }
  }

  store.patchCoreMemory(characterId, { relationship_with_user: rel });
}

/** Push an emotional event; keep only the last 8 */
export function addEmotionalEvent(
  characterId: string,
  event:       Omit<EmotionalEvent, "timestamp">
): void {
  const store    = getStore();
  const existing = store.getCoreMemory(characterId);
  if (!existing) return;

  const events = [
    { ...event, timestamp: new Date().toISOString() },
    ...(existing.data.recent_emotional_events ?? []),
  ].slice(0, 8);

  store.patchCoreMemory(characterId, { recent_emotional_events: events });
}

/** Replace internal thoughts (keep last 5) */
export function setInternalThoughts(characterId: string, thoughts: string[]): void {
  getStore().patchCoreMemory(characterId, {
    internal_thoughts: thoughts.slice(0, 5),
  });
}

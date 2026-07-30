// ─── Core Memory Store (Drawer 1) ─────────────────────────────────────────────
// Server-side only. Thin wrappers around FableStore for Core Memory operations.
// Import from API routes; do NOT import in client components.
// All operations are scoped by chatId — each chat is its own story.

import { getStore } from "@/lib/db";
import type { CoreMemory, DbCoreMemory, EmotionalEvent } from "@/lib/db/models";

// ─── Read ─────────────────────────────────────────────────────────────────────

export function getCoreMemory(chatId: string, characterId: string): DbCoreMemory | null {
  return getStore().getCoreMemory(chatId, characterId);
}

export function ensureCoreMemory(
  chatId:        string,
  characterId:   string,
  characterName: string
): DbCoreMemory {
  return getStore().ensureCoreMemory(chatId, characterId, characterName);
}

// ─── Write ────────────────────────────────────────────────────────────────────

export function setCoreMemory(chatId: string, cm: CoreMemory): void {
  getStore().setCoreMemory(chatId, cm);
}

export function patchCoreMemory(
  chatId:      string,
  characterId: string,
  patch:       Partial<CoreMemory>
): DbCoreMemory | null {
  return getStore().patchCoreMemory(chatId, characterId, patch);
}

// ─── Convenience updaters ─────────────────────────────────────────────────────

/** Merge new Drawer-2 stats into the core memory relationship block */
export function syncStatsToCore(chatId: string, characterId: string): void {
  const store    = getStore();
  const existing = store.getCoreMemory(chatId, characterId);
  if (!existing) return;

  // Direction is character -> player: relationship_with_user means how *this
  // character* feels about the user, which is also what the system prompt
  // injects and what characterSummary() reads.
  const stats = store.queryStats(chatId, characterId, "player");
  const rel   = { ...existing.data.relationship_with_user };

  for (const [statName, row] of Object.entries(stats)) {
    if (row) {
      // Drawer 2 stats live on −100..100; Core Memory's relationship block
      // uses 0..100 with 50 as neutral. Rescale so e.g. trust +42 → 71.
      (rel as Record<string, number>)[statName] = Math.round((row.value + 100) / 2);
    }
  }

  store.patchCoreMemory(chatId, characterId, { relationship_with_user: rel });
}

/** Push an emotional event; keep only the last 8 */
export function addEmotionalEvent(
  chatId:      string,
  characterId: string,
  event:       Omit<EmotionalEvent, "timestamp">
): void {
  const store    = getStore();
  const existing = store.getCoreMemory(chatId, characterId);
  if (!existing) return;

  const events = [
    { ...event, timestamp: new Date().toISOString() },
    ...(existing.data.recent_emotional_events ?? []),
  ].slice(0, 8);

  store.patchCoreMemory(chatId, characterId, { recent_emotional_events: events });
}

/** Replace internal thoughts (keep last 5) */
export function setInternalThoughts(chatId: string, characterId: string, thoughts: string[]): void {
  getStore().patchCoreMemory(chatId, characterId, {
    internal_thoughts: thoughts.slice(0, 5),
  });
}

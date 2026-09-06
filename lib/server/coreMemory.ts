// ─── Core Memory sync (Drawer 2 → Drawer 1) ───────────────────────────────────
// Server-side only — the directory says so; it reaches SQLite directly.
// All operations are scoped by chatId — each chat is its own story.
//
// Plain reads and writes belong on FableStore directly (getStore().getCoreMemory
// etc.). Only the two projections below live here, because each carries logic
// the store has no business knowing: the −100..100 → 0..100 rescale, and the
// commitment labelling.

import { getStore } from "@/lib/db";

/** Merge new Drawer-2 stats into the core memory relationship block */
export function syncStatsToCore(chatId: string, characterId: string): void {
  const store    = getStore();
  const existing = store.getCoreMemory(chatId, characterId);
  if (!existing) return;

  // Direction is character -> player: relationship_with_user means how *this
  // character* feels about the user, which is also what the system prompt
  // injects and what getCharacterSummary() reads.
  const stats = store.queryStats(chatId, characterId, "player");
  const rel   = { ...existing.data.relationship_with_user };

  for (const [statName, row] of Object.entries(stats)) {
    if (row) {
      // Drawer 2 stats live on −100..100; Core Memory's relationship block
      // uses 0..100 with 50 as neutral. Rescale so e.g. trust +42 → 71.
      (rel as Record<string, number>)[statName] = Math.round((row.value + 100) / 2);
    }
  }

  // The rupture note keeps a wound present in the prompt even after the
  // numbers start to recover — otherwise the character forgives the moment
  // the stats do.
  const relationship_note = store.isRecentlyRuptured(chatId, characterId, "player")
    ? "Something between you was recently damaged. It has not fully healed — warmth returns slowly, and it colours how you respond."
    : null;

  store.patchCoreMemory(chatId, characterId, { relationship_with_user: rel, relationship_note });
}

/**
 * Mirror active commitments (both directions) into Core Memory so the prompt's
 * [Active Commitments] block is real. Character's own promises first.
 */
export function syncCommitmentsToCore(chatId: string, characterId: string, personaLabel = "the user"): void {
  const store    = getStore();
  const existing = store.getCoreMemory(chatId, characterId);
  if (!existing) return;

  const active = store.listAllCommitments(chatId, "active");
  const mine   = active.filter((c) => c.promisorId === characterId);
  const theirs = active.filter((c) => c.promisorId !== characterId);
  // Third-party promisors render by display name, not raw entity id
  const label = (id: string): string =>
    id === "player" ? personaLabel : store.getEntity(chatId, id)?.name ?? id;
  const lines = [
    ...mine.map((c) => `You promised: ${c.description}`),
    ...theirs.map((c) => `${label(c.promisorId)} promised: ${c.description}`),
  ].slice(0, 8);

  store.patchCoreMemory(chatId, characterId, { active_commitments: lines });
}

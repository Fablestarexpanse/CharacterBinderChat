// ─── Prompt retrieval ─────────────────────────────────────────────────────────
// What goes into the system prompt, and in what order. Server-side only: it
// reads through FableStore.
//
// This is policy, not persistence — relevance scoring, pinning, per-group
// quotas and the final string rendering — and it lived inside the SQL class
// until it was moved here. FableStore now answers row-level questions
// (queryAllLiveFacts, listMemoryCards, factEmbedding, cardEmbedding,
// getEntities) and this module decides what to do with the answers.

import type { FableStore } from "@/lib/db/store";
import type { DbFact, DbMemoryCard } from "@/lib/db/models";
import { isDurableFact, isIdentityCoreFact } from "@/lib/db/predicates";
import { embeddingRelevance } from "@/lib/llm/embeddings";
import { contentWords, coverage } from "@/lib/text/overlap";

/**
 * `context` is recent conversation text. Without it relevance is 0 everywhere
 * and ordering falls back to the structural ranking. `queryEmbedding` is that
 * same text embedded, when embeddings are available.
 */
export interface RetrievalOptions {
  limit?:          number;
  context?:        string;
  queryEmbedding?: Float32Array | null;
}

/**
 * Retrieve the currently-valid facts to inject into the system prompt.
 *
 * Two failure modes shaped this, both caught by tests/memory-eval:
 *
 * 1. It used to consider ONLY facts whose subject or object was the character.
 *    Everything the player says about themselves is stored under the `player`
 *    entity, so none of it was ever retrievable — the character could not
 *    remember your sister, your fear, or what you promised. For roleplay that
 *    is the wrong half of the graph. Facts about the player are now a
 *    first-class group with their own guaranteed share of the window.
 *
 * 2. Ranking by confidence-then-recency alone does not survive a long story.
 *    Every exchange adds facts, so anything learned early is pushed out within
 *    a handful of turns. Durable facts (identity, kinship, fears, promises,
 *    location) are therefore ranked ahead of incidental ones inside each group.
 *
 * Facts about neither participant — world knowledge picked up along the way —
 * compete for the remaining slots on relevance to the current conversation.
 *
 * `context` is recent conversation text; without it relevance is 0 everywhere
 * and ordering falls back to durable-then-confidence-then-recency.
 */
export function retrieveFactsForPrompt(
  store: FableStore,
  chatId: string,
  characterId: string,
  { limit = 20, context = "", queryEmbedding = null }: RetrievalOptions = {}
): string[] {
  // The player's entity id is fixed app-wide; facts are stored against it
  // literally, so there is nothing for a caller to vary here.
  const playerId = "player";
  // Witness filter: known_to = [] means public (every 1:1 fact); a
  // non-empty list restricts the fact to characters who were present when
  // it was established. A group member who was out of the scene must not
  // "remember" what happened without them.
  const all = store.queryAllLiveFacts(chatId).filter(
    (f) => f.knownTo.length === 0 || f.knownTo.includes(characterId)
  );

  // Relevance: cosine similarity against the current exchange when both
  // sides have embeddings (semantic — "the crossing" matches "afraid of deep
  // water"), keyword overlap otherwise (lexical fallback).
  //
  // Scored once per fact, before any sorting. The comparator used to call
  // this, and it opened a SQLite query per call — a per-row read run
  // O(n log n) times.
  const contextWords = contentWords(context);
  const vectors = queryEmbedding ? store.getEmbeddings("facts", all.map((f) => f.id)) : null;
  const relevance = new Map<number, number>(all.map((f) => [
    f.id,
    queryEmbedding
      ? embeddingRelevance(queryEmbedding, vectors!.get(f.id))
      : contextWords.size === 0
        ? 0
        : coverage(contentWords(`${f.predicate} ${f.objectId ?? ""} ${f.objectLiteral ?? ""}`), contextWords),
  ]));
  const relevanceOf = (f: DbFact) => relevance.get(f.id) ?? 0;

  // Importance first (with the durable-predicate heuristic as a floor, so a
  // model that under-scores kinship/fear/promise facts can't age them out),
  // then relevance to the current exchange, then confidence, then recency.
  const importanceOf = (f: DbFact): number =>
    Math.max(f.importance, isDurableFact(f.predicate) ? 0.75 : 0);
  const rank = (a: DbFact, b: DbFact) =>
    (importanceOf(b) - importanceOf(a)) ||
    (relevanceOf(b) - relevanceOf(a)) ||
    (b.confidence - a.confidence) ||
    (b.tValidStart - a.tValidStart);

  const involves = (f: DbFact, id: string) => f.subjectId === id || f.objectId === id;

  // ── Pinned identity-core facts ────────────────────────────────────────
  // Family, fears, obligations, self-definition about either participant
  // bypass relevance ranking entirely. At 120 live facts vs a 20-slot
  // window, "sister Lila" fell out of the ranked pool late in the Tilly
  // soak and the model confabulated the opposite ("you're an only child")
  // rather than saying it didn't know. The cost of a miss here is
  // confident fiction, so these facts don't compete — they're always in.
  const PIN_CAP = Math.max(2, Math.floor(limit * 0.4));
  const pinned = all
    .filter((f) => (involves(f, characterId) || involves(f, playerId)) && isIdentityCoreFact(f.predicate))
    .sort(rank)
    .slice(0, PIN_CAP);
  const isPinned = new Set(pinned.map((f) => f.id));

  const aboutCharacter = all.filter((f) => !isPinned.has(f.id) && involves(f, characterId)).sort(rank);
  const aboutPlayer    = all.filter((f) => !isPinned.has(f.id) && !involves(f, characterId) && involves(f, playerId)).sort(rank);
  const world          = all.filter((f) => !isPinned.has(f.id) && !involves(f, characterId) && !involves(f, playerId)).sort(rank);

  // Each participant gets a guaranteed share of the remaining room so
  // neither can be crowded out. Take quotas first, then backfill any unused
  // room in group order, so a sparse group never wastes slots.
  const room = Math.max(0, limit - pinned.length);
  const quota = Math.max(1, Math.floor(room * 0.4));
  const groups = [aboutCharacter, aboutPlayer, world];
  const topFacts: DbFact[] = [
    ...pinned,
    ...aboutCharacter.slice(0, quota),
    ...aboutPlayer.slice(0, quota),
  ];
  for (const group of groups) {
    for (const f of group) {
      if (topFacts.length >= limit) break;
      if (!topFacts.includes(f)) topFacts.push(f);
    }
  }
  topFacts.length = Math.min(topFacts.length, limit);

  // Batch-fetch all referenced entities in one query (avoids N+1 per fact)
  const entityIds = new Set<string>();
  for (const f of topFacts) {
    entityIds.add(f.subjectId);
    if (f.objectId) entityIds.add(f.objectId);
  }
  const entityMap = store.getEntities(chatId, Array.from(entityIds));

  return topFacts.map((f) => {
    const subj = entityMap.get(f.subjectId)?.name ?? f.subjectId;
    const obj  = store.formatFactObject(chatId, f, (id) => entityMap.get(id) ?? null);
    return `${subj} ${f.predicate} ${obj}`;
  });
}

/**
 * Episodic memories to inject into the prompt: scene cards and reflections,
 * ranked by importance with a recency tiebreak, optionally boosted by
 * relevance to the current conversation.
 */
export function retrieveEpisodesForPrompt(
  store: FableStore,
  chatId: string,
  { limit = 3, context = "", queryEmbedding = null }: RetrievalOptions = {}
): DbMemoryCard[] {
  // Bond cards (shared language) have their own retrieval path
  const cards = store.listMemoryCards(chatId).filter((c) => !c.tags.includes("bond"));
  if (cards.length === 0) return [];
  const contextWords = contentWords(context);
  const vectors = queryEmbedding ? store.getEmbeddings("memory_cards", cards.map((c) => c.id)) : null;
  // Scored once, then sorted — same reason as the facts path above.
  const scored = cards.map((card) => ({
    card,
    score: card.importance + (
      queryEmbedding
        ? embeddingRelevance(queryEmbedding, vectors!.get(card.id))
        : contextWords.size === 0
          ? 0
          : coverage(contentWords(`${card.title} ${card.content}`), contextWords)
    ),
  }));
  return scored
    .sort((a, b) => (b.score - a.score) || (b.card.createdAt - a.card.createdAt))
    .slice(0, limit)
    .map((s) => s.card);
}

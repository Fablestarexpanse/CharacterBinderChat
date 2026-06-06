// ─── Fact predicate utilities ─────────────────────────────────────────────────
// Shared by the extraction route and the manual facts route so supersession
// behaviour is consistent regardless of how a fact reaches the store.

/**
 * Predicates where a subject can have only ONE current value.
 * A new fact with one of these predicates supersedes any prior live fact
 * for the same (subject, predicate) pair with a different object.
 *
 * Must stay in sync with the PREDICATE VOCABULARY section of buildExtractionPrompt.
 */
export const SINGLE_VALUED_PREDICATES = new Set([
  // canonical forms — what the LLM is instructed to emit
  "lives_at",
  "located_at",
  "works_at",
  "current_location",
  "status",
  "is",
  // loose variants kept for robustness against legacy data or manual API calls
  "lives at",
  "located at",
  "located in",
  "works at",
  "current location",
  "resides_at",
  "resides at",
  "based_at",
  "based at",
]);

/** Normalise a predicate for lookup in SINGLE_VALUED_PREDICATES */
export function normPredicate(p: string): string {
  return p.toLowerCase().trim().replace(/\s+/g, " ");
}

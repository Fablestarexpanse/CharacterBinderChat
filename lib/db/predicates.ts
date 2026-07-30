// ─── Fact predicate utilities ─────────────────────────────────────────────────
// Shared by the extraction route and the manual facts route so supersession
// behaviour is consistent regardless of how a fact reaches the store.

/**
 * Predicates where a subject can have only ONE current value.
 * A new fact with one of these predicates supersedes any prior live fact
 * for the same (subject, predicate) pair with a different object.
 *
 * Contains canonical forms only — normPredicate() maps synonyms and legacy
 * spellings onto these before lookup.
 * Must stay in sync with the PREDICATE VOCABULARY section of buildExtractionPrompt.
 */
export const SINGLE_VALUED_PREDICATES = new Set([
  "lives_at",
  "located_at",
  "works_at",
  "current_location",
  "status",
  "is",
]);

/**
 * Synonyms / legacy spellings → canonical predicate.
 * Keyed by snake_case (normPredicate lowercases and snake_cases before lookup).
 * "is_located_at" appears in pre-vocabulary data written before commit 483048b.
 */
const PREDICATE_ALIASES: Record<string, string> = {
  is_located_at: "located_at",
  located_in:    "located_at",
  based_at:      "located_at",
  resides_at:    "lives_at",
  lives_in:      "lives_at",
};

/**
 * Normalise a predicate to its canonical snake_case form.
 * Used both for SINGLE_VALUED_PREDICATES lookups and for equality checks
 * during dedup/supersession, so "is_located_at", "located in" and
 * "located_at" all compare equal.
 */
export function normPredicate(p: string): string {
  const snake = p.toLowerCase().trim().replace(/\s+/g, "_");
  return PREDICATE_ALIASES[snake] ?? snake;
}

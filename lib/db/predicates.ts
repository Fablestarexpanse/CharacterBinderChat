// ─── Fact predicate utilities ─────────────────────────────────────────────────
// Shared by the extraction route and the manual facts route so dedup and
// supersession behave identically regardless of how a fact reaches the store.

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
 * Groups of predicates that answer the same question, and so must supersede
 * one another rather than piling up.
 *
 * A model asked "where are you?" will drift between lives_at / located_at /
 * current_location across turns. Comparing raw predicates lets each spelling
 * keep its own live fact, so a character ends up simultaneously living in two
 * places — the exact contradiction supersession exists to prevent. Comparing
 * families instead makes drift harmless.
 *
 * `works_at` deliberately stays out of the location family: where someone
 * lives and where they work are genuinely independent facts.
 */
const PREDICATE_FAMILIES: Record<string, string> = {
  lives_at:         "location",
  located_at:       "location",
  current_location: "location",
  works_at:         "workplace",
  status:           "status",
  is:               "identity",
};

/** Families where a subject can have only ONE current value. */
const SINGLE_VALUED_FAMILIES = new Set(["location", "workplace", "status", "identity"]);

/**
 * Canonical form of a predicate — what gets stored.
 * Lowercases, snake_cases, and resolves aliases, so "is_located_at",
 * "Located In" and "located_at" all become "located_at".
 */
export function normPredicate(p: string): string {
  const snake = p.toLowerCase().trim().replace(/\s+/g, "_");
  return PREDICATE_ALIASES[snake] ?? snake;
}

/**
 * The comparison key for dedup and supersession. Predicates in a shared family
 * collapse to that family; everything else is its own key.
 */
export function predicateFamily(p: string): string {
  const canonical = normPredicate(p);
  return PREDICATE_FAMILIES[canonical] ?? canonical;
}

/** Whether a new fact with this predicate should supersede prior live ones. */
export function isSingleValued(p: string): boolean {
  return SINGLE_VALUED_FAMILIES.has(predicateFamily(p));
}

/**
 * Canonical single-valued predicates, for prompts and docs.
 * Derived so it can't drift out of sync with the family table.
 */
export const SINGLE_VALUED_PREDICATES = new Set(
  Object.entries(PREDICATE_FAMILIES)
    .filter(([, family]) => SINGLE_VALUED_FAMILIES.has(family))
    .map(([predicate]) => predicate)
);

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
 * Substrings marking a predicate as character-defining rather than incidental.
 *
 * These are the facts a player expects a character to hold onto for the whole
 * story — who their family is, what they fear, what they promised. Ranking on
 * recency alone ages them out within a few exchanges, so retrieval reserves
 * space for them. Matched as substrings because non-vocabulary predicates are
 * free-form ("has_sister", "is_afraid_of", "promised_to").
 */
const DURABLE_PREDICATE_HINTS = [
  // kinship
  "sister", "brother", "sibling", "mother", "father", "parent", "child",
  "son", "daughter", "wife", "husband", "spouse", "married", "family", "kin",
  // fears and drives
  "fear", "afraid", "phobia", "dread", "hope", "want",
  // obligations
  "promis", "owes", "owed", "swore", "vow", "oath", "commit", "debt", "deadline",
  // standing relations
  "loves", "hates", "trusts", "distrusts", "loyal", "betray", "protect", "trust",
  // self-definition
  "name", "alias", "title", "rank", "occupation", "job", "profession", "role",
];

/**
 * Whether a fact should be treated as part of the character sheet, and so given
 * reserved space in the prompt regardless of how old it is.
 * Single-valued predicates (identity, location, workplace, status) always count.
 */
export function isDurableFact(predicate: string): boolean {
  if (isSingleValued(predicate)) return true;
  const p = normPredicate(predicate);
  return DURABLE_PREDICATE_HINTS.some((hint) => p.includes(hint));
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

// ─── Lexical overlap ──────────────────────────────────────────────────────────
// The fallback used everywhere embeddings are unavailable or overkill: strip
// punctuation, keep the words long enough to carry meaning, and compare sets.
//
// Every caller had its own inline copy of the tokenizer, in three slightly
// different shapes, which made the one deliberate difference — the
// resolved-commitment rule below scores coverage of the incoming phrase, not
// symmetric similarity — look like another accident.

/** Words of four characters or more, lowercased, punctuation stripped. */
export function contentWords(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3)
  );
}

/** Whole text, lowercased and punctuation-flattened — for comparing short strings whole. */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Symmetric similarity: shared words over total distinct words. 0 when either side is empty. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const w of a) if (b.has(w)) overlap++;
  return overlap / (a.size + b.size - overlap);
}

/**
 * Asymmetric: what share of `needle`'s words appear in `haystack`. Used for
 * ranking a stored item against the current conversation, where the
 * conversation is much longer and a symmetric score would punish it for that.
 */
export function coverage(needle: Set<string>, haystack: Set<string>): number {
  if (needle.size === 0) return 0;
  let hit = 0;
  for (const w of needle) if (haystack.has(w)) hit++;
  return hit / needle.size;
}

// ─── Lorebook keyword injection ───────────────────────────────────────────────
// Scans recent conversation text for lore entry keywords and returns the
// matched entries, priority-sorted and token-capped, ready for the [World
// Lore] prompt section. Matching is deliberately simple and predictable:
// case-insensitive whole-word-ish substring match on each comma-separated
// keyword. No embeddings — lore should fire exactly when its trigger words
// appear, and never otherwise.

import { estimateTokens } from "./promptBuilder";
import type { Lorebook, LoreEntry } from "@/lib/types";

/** Default token budget for injected lore (matches the LoreTab meter). */
export const LORE_TOKEN_BUDGET = 500;

/** Split an entry's key field into individual keywords ("Kaspar, Kaspar Division"). */
export function entryKeywords(entry: LoreEntry): string[] {
  return entry.key
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0);
}

/**
 * Whether an entry fires against (lowercased) recent conversation text —
 * THE single source of truth, shared by generation and the inspector so the
 * Lore tab never claims an entry is injected that generation would skip.
 */
export function entryTriggered(entry: LoreEntry, haystackLower: string): boolean {
  if (!entry.enabled || !entry.value.trim()) return false;
  return entry.constant || entryKeywords(entry).some((k) => keywordMatches(k, haystackLower));
}

function keywordMatches(keyword: string, haystack: string): boolean {
  // Word-boundary match when the keyword is plain word characters, so "art"
  // doesn't fire on "particle". Falls back to substring for keys with
  // punctuation/spaces where \b behaves badly.
  if (/^[\w][\w ]*[\w]$/.test(keyword) || /^\w$/.test(keyword)) {
    return new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(haystack);
  }
  return haystack.includes(keyword);
}

/**
 * Match enabled lore entries against recent conversation text.
 * Returns formatted "key: value" strings, highest priority first, capped to
 * the token budget. Entries with equal priority keep lorebook order.
 */
export function matchLoreEntries(
  lorebooks: Lorebook[],
  recentText: string,
  budget = LORE_TOKEN_BUDGET
): string[] {
  const haystack = recentText.toLowerCase();
  if (!haystack.trim()) return [];

  const matched: LoreEntry[] = [];
  for (const book of lorebooks) {
    for (const entry of book.entries) {
      if (entryTriggered(entry, haystack)) matched.push(entry);
    }
  }

  matched.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  const out: string[] = [];
  let spent = 0;
  for (const entry of matched) {
    const line = `${entry.key.split(",")[0].trim()}: ${entry.value.trim()}`;
    const cost = estimateTokens(line);
    if (spent + cost > budget && out.length > 0) continue; // keep at least one
    if (cost > budget && out.length === 0) continue;       // single oversized entry
    out.push(line);
    spent += cost;
  }
  return out;
}

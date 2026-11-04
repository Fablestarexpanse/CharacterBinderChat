// ─── Lorebook keyword injection ───────────────────────────────────────────────
// Scans recent conversation text for lore entry keywords and returns the
// matched entries, priority-sorted and token-capped, ready for the [World
// Lore] prompt section. Matching is deliberately simple and predictable:
// case-insensitive whole-word-ish substring match on each comma-separated
// keyword. No embeddings — lore should fire exactly when its trigger words
// appear, and never otherwise.

import { estimateTokens } from "./promptBuilder";
import type { Lorebook, LoreEntry, Chat } from "@/lib/types";

/** Default token budget for injected lore (matches the LoreTab meter). */
export const LORE_TOKEN_BUDGET = 500;

/**
 * The lorebooks (worlds) active for a chat. Undefined selection = every book
 * (legacy chats); otherwise only the chosen worlds inject — THE shared filter
 * for generation and the Lore tab, so the meter never disagrees with the
 * prompt.
 */
export function booksForChat(lorebooks: Lorebook[], chat: Pick<Chat, "lorebookIds"> | undefined): Lorebook[] {
  const ids = chat?.lorebookIds;
  if (ids === undefined) return lorebooks;
  return lorebooks.filter((b) => ids.includes(b.id));
}

/** Split a comma-separated key field into individual keywords. */
function splitKeys(field: string): string[] {
  return field.split(",").map((k) => k.trim()).filter((k) => k.length > 0);
}

/** An entry's primary keywords ("Kaspar, Kaspar Division"). */
function entryKeywords(entry: LoreEntry): string[] {
  return splitKeys(entry.key);
}

/**
 * Whether an entry fires against recent conversation text — THE single source
 * of truth, shared by generation and the inspector so the Lore tab never claims
 * an entry is injected that generation would skip.
 *
 * Takes the text as written, not lowercased: a case-sensitive entry has to see
 * the original. Selective entries need a primary keyword AND a secondary one
 * ("fire on 'Mira' only when the talk is also about 'sword'").
 */
export function entryTriggered(entry: LoreEntry, text: string): boolean {
  if (!entry.enabled || !entry.value.trim()) return false;
  if (entry.constant) return true;

  const sensitive = entry.caseSensitive === true;
  const haystack = sensitive ? text : text.toLowerCase();
  const matches = (keys: string[]) =>
    keys.some((k) => keywordMatches(sensitive ? k : k.toLowerCase(), haystack, sensitive));

  if (!matches(entryKeywords(entry))) return false;
  const secondary = (entry.secondaryKeys ?? []).filter((k) => k.trim());
  return entry.selective && secondary.length > 0 ? matches(secondary.map((k) => k.trim())) : true;
}

function keywordMatches(keyword: string, haystack: string, caseSensitive: boolean): boolean {
  // Word-boundary match when the keyword is plain word characters, so "art"
  // doesn't fire on "particle". Falls back to substring for keys with
  // punctuation/spaces where \b behaves badly.
  if (/^[\w][\w ]*[\w]$/.test(keyword) || /^\w$/.test(keyword)) {
    return new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, caseSensitive ? "" : "i").test(haystack);
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
  // No early return on empty text: constant entries fire regardless of the
  // conversation, and skipping them on the first turn of a new chat dropped
  // exactly the always-on world lore the chat was started with. Keyword
  // entries already fail to match an empty haystack.
  const matched: LoreEntry[] = [];
  for (const book of lorebooks) {
    for (const entry of book.entries) {
      if (entryTriggered(entry, recentText)) matched.push(entry);
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

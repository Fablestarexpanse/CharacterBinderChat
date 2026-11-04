// ─── Extraction gate ──────────────────────────────────────────────────────────
// A cheap check run before the memory calls (extract, core-memory rewrite) that
// skips them for an exchange with nothing in it: "ok" / "*nods*".
//
// Deliberately narrow. Offline evidence (tests/memory-eval/gate-offline.mjs, 499
// exchanges from the 200-exchange soaks) showed that content-based prediction of
// "will extraction find anything" is barely better than chance on real roleplay
// turns — a novelty heuristic that skipped 15% of turns would have skipped 23
// that added a fact. So this does not try to be smart. It only skips exchanges
// too short to hold anything, and it is safe for a structural reason rather than
// a statistical one: extraction reads the last 16 messages, so a skipped turn is
// picked up by the next extraction that runs. Skipping delays; it does not drop.
// A consecutive-skip cap bounds the delay.

export type ExtractionGateMode = "off" | "trivial";

/** Content words (not stopwords) below which an exchange counts as empty. */
export const TRIVIAL_WORD_LIMIT = 8;

/** Never skip more than this many exchanges in a row. */
export const MAX_CONSECUTIVE_SKIPS = 3;

const STOP = new Set(
  ("the a an and or but if then of to in on at for with from by as is are was were be been it its this " +
   "that these those you your i me my we our they their he she him her his not no yes do does did have " +
   "has had will would can could should may might just so than too very about into over under up down " +
   "out off again more some any each other such only own same now ok okay yeah yep nope hmm hm uh um " +
   "oh ah heh haha lol thanks thank").split(/\s+/)
);

/** Words that carry content: letters only, 3+ long, not a stopword. */
export function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z']+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * True when the exchange has nothing worth extracting. Anything with a digit
 * (a time, a price, a count) is never trivial, nor is a mid-sentence capitalised
 * word (a name) — cheap tells that a short line still carries a fact.
 */
export function isTrivialExchange(userText: string, assistantText: string): boolean {
  const text = `${userText} ${assistantText}`;
  if (/\d/.test(text)) return false;
  if (/(?<=[a-z,;:]\s)[A-Z][a-z]+/.test(text)) return false;
  return contentWords(text).length < TRIVIAL_WORD_LIMIT;
}

/** Skip decision with its own bookkeeping, one instance per chat. */
export function createGate() {
  let skips = 0;
  return {
    /** Returns true to extract now. Call once per finished exchange. */
    shouldExtract(mode: ExtractionGateMode, userText: string, assistantText: string): boolean {
      if (mode === "off" || skips >= MAX_CONSECUTIVE_SKIPS || !isTrivialExchange(userText, assistantText)) {
        skips = 0;
        return true;
      }
      skips++;
      return false;
    },
  };
}

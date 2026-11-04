// ─── Quick Import text parser ─────────────────────────────────────────────────
// Ported unchanged from CharacterBinder (src/shared/cardTextParser.ts, MIT). Pure
// and self-contained: no DOM, no imports. FableChat uses it for "paste anything"
// in the character editor. Its tests came across too (tests/unit/cardsTextParser).
// Keep behaviour changes out of this file unless the tests move with them.

/**
 * Persona text parser.
 *
 * Takes a single blob of unstructured persona text — the kind you copy out of
 * JanitorAI, Chub, a Discord message, or a notes file — and works out which
 * parts belong in which persona field.
 *
 * Four strategies, tried in order:
 *   json     — the blob is a JSON card export
 *   wpp      — W++ / attribute-list style:  Personality("kind" + "shy")
 *   labelled — Name: / Appearance: / ## Background / [Personality] sections
 *   prose    — no structure at all; sorted paragraph-by-paragraph on keywords
 *
 * Nothing is ever dropped. Text the parser can't confidently place lands in
 * Description, and labelled sections it doesn't recognise (Age, Gender, Likes…)
 * are appended to Description with their original label intact.
 */

/**
 * Every field the parser knows how to fill. Individual editors consume a subset:
 * personas use appearance/background, character cards use scenario/first_mes/
 * mes_example instead. See PERSONA_FIELD_ORDER and CHARACTER_FIELD_ORDER.
 */
export type CardField =
  | "name"
  | "description"
  | "personality"
  | "appearance"
  | "background"
  | "scenario"
  | "first_mes"
  | "mes_example"
  | "creator"
  | "creator_notes";

export type ParseMethod = "json" | "wpp" | "labelled" | "prose" | "empty" | "ai";

export interface ParsedCardText {
  fields: Partial<Record<CardField, string>>;
  tags: string[];
  method: ParseMethod;
  /** Human-readable explanation of what the parser did and how sure it is. */
  notes: string[];
}

export const PERSONA_FIELD_LABELS: Record<CardField, string> = {
  name: "Persona Name",
  description: "Description",
  personality: "Personality",
  appearance: "Appearance",
  background: "Background",
  scenario: "Scenario",
  first_mes: "First Message",
  mes_example: "Example Dialogs",
  creator: "Creator",
  creator_notes: "Creator Notes",
};

export const CHARACTER_FIELD_LABELS: Record<CardField, string> = {
  ...PERSONA_FIELD_LABELS,
  name: "Character Name",
};

/** Field order used when rendering the preview. */
export const PERSONA_FIELD_ORDER: CardField[] = [
  "name",
  "description",
  "personality",
  "appearance",
  "background",
  "creator",
  "creator_notes",
];

/**
 * Character cards have no appearance/background of their own — that detail
 * belongs in description — but they do carry scenario, greeting, and examples.
 */
export const CHARACTER_FIELD_ORDER: CardField[] = [
  "name",
  "description",
  "personality",
  "scenario",
  "first_mes",
  "mes_example",
  "creator",
  "creator_notes",
];

// ── Label vocabulary ────────────────────────────────────────────────────────
// Aliases are matched after normalisation (lowercased, punctuation stripped).
// Order matters: the first table entry whose alias matches exactly wins.

type LabelTarget = CardField | "tags";

const LABEL_ALIASES: Array<[LabelTarget, string[]]> = [
  ["name", ["name", "persona name", "full name", "character name", "char name", "char", "character", "alias", "goes by", "called"]],
  ["appearance", ["appearance", "appearances", "looks", "physical", "physical appearance", "physical description", "physique", "body", "outfit", "outfits", "clothing", "clothes", "attire", "features", "description of appearance"]],
  ["personality", ["personality", "personalities", "traits", "trait", "character traits", "temperament", "mannerisms", "manner", "behaviour", "behavior", "demeanour", "demeanor", "quirks", "disposition", "attitude", "habits", "habit", "interests", "interest", "hobbies", "hobby", "strengths", "strength", "flaws", "flaw", "weaknesses", "weakness", "fears", "goals", "motivations"]],
  ["background", ["background", "backstory", "back story", "history", "biography", "origin", "origins", "past", "lore", "occupation", "job", "profession", "career", "story", "reputation", "education"]],
  ["description", ["description", "desc", "about", "summary", "overview", "persona", "bio", "profile", "intro", "introduction", "general", "quote", "quotes", "catchphrase"]],
  ["scenario", ["scenario", "setting", "situation", "world", "world info", "context", "premise"]],
  ["first_mes", ["first message", "first mes", "greeting", "opening message", "opening line", "intro message", "initial message", "first_mes"]],
  ["mes_example", ["example dialogs", "example dialogue", "example dialogues", "example messages", "dialogue examples", "sample dialogue", "examples", "mes example", "mes_example"]],
  ["creator", ["creator", "author", "made by", "created by", "by"]],
  ["creator_notes", ["creator notes", "notes", "note", "authors note", "author notes", "creators note"]],
  ["tags", ["tags", "tag", "keywords", "categories"]],
];

const LABEL_LOOKUP = new Map<string, LabelTarget>();
for (const [target, aliases] of LABEL_ALIASES) {
  for (const alias of aliases) {
    if (!LABEL_LOOKUP.has(alias)) LABEL_LOOKUP.set(alias, target);
  }
}

/** Longest alias, in words — bounds how much of a line we'll treat as a label. */
const MAX_LABEL_WORDS = 3;

function normaliseLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[_*#`~]/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lookupLabel(raw: string): LabelTarget | null {
  const key = normaliseLabel(raw);
  if (!key || key.split(" ").length > MAX_LABEL_WORDS) return null;
  return LABEL_LOOKUP.get(key) ?? null;
}

// ── Keyword vocabulary for unstructured prose ───────────────────────────────

const APPEARANCE_WORDS = [
  "hair", "eyes", "eye", "tall", "short", "height", "build", "skin", "complexion",
  "wears", "wearing", "wore", "outfit", "dressed", "dress", "clothes", "clothing",
  "freckles", "scar", "scars", "tattoo", "tattoos", "muscular", "slender", "slim",
  "curvy", "petite", "beard", "stubble", "figure", "frame", "pale", "tanned", "olive",
  "blonde", "blond", "brunette", "redhead", "piercing", "piercings", "glasses",
  "cheekbones", "jaw", "lips", "smile", "posture", "shoulders", "hands", "fingers",
  "inches", "feet", "cm", "ft", "lbs", "kg", "pounds", "physique", "appearance",
];

const PERSONALITY_WORDS = [
  "kind", "shy", "outgoing", "sarcastic", "quiet", "loud", "tempered", "temper",
  "friendly", "cold", "warm", "stubborn", "loyal", "curious", "playful", "serious",
  "anxious", "confident", "personality", "enjoys", "loves", "hates", "dislikes",
  "likes", "humor", "humour", "patient", "impatient", "blunt", "gentle", "protective",
  "flirty", "awkward", "witty", "calm", "ambitious", "arrogant", "humble", "cheerful",
  "moody", "reserved", "charming", "ruthless", "compassionate", "cynical", "optimistic",
  "pessimistic", "tends", "prefers", "avoids", "struggles", "fears", "believes",
  "trusts", "temperament", "demeanor", "demeanour", "attitude", "mannerisms",
];

const BACKGROUND_WORDS = [
  "born", "grew", "raised", "childhood", "family", "parents", "mother", "father",
  "orphan", "orphaned", "sibling", "brother", "sister", "works", "worked", "job",
  "occupation", "studied", "university", "college", "school", "academy", "trained",
  "training", "apprentice", "graduated", "career", "moved", "hometown", "village",
  "city", "war", "battle", "guild", "order", "exiled", "inherited", "founded",
  "history", "backstory", "past", "years ago", "since then", "eventually", "before",
];

function scoreWords(text: string, words: string[]): number {
  const lower = " " + text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ") + " ";
  let score = 0;
  for (const w of words) {
    if (lower.includes(" " + w + " ")) score++;
  }
  return score;
}

// ── Entry point ─────────────────────────────────────────────────────────────

export function parseCardText(raw: string): ParsedCardText {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (!text) {
    return { fields: {}, tags: [], method: "empty", notes: ["Nothing to import — paste some text first."] };
  }

  return parseJson(text) ?? parseWpp(text) ?? parseLabelled(text) ?? parseProse(text);
}

// ── Strategy 1: JSON ────────────────────────────────────────────────────────

const JSON_KEY_MAP: Record<string, LabelTarget> = {
  name: "name",
  char_name: "name",
  persona_name: "name",
  description: "description",
  persona: "description",
  desc: "description",
  summary: "description",
  bio: "description",
  personality: "personality",
  char_persona: "personality",
  traits: "personality",
  appearance: "appearance",
  looks: "appearance",
  physical: "appearance",
  background: "background",
  backstory: "background",
  history: "background",
  scenario: "scenario",
  world: "scenario",
  setting: "scenario",
  first_mes: "first_mes",
  first_message: "first_mes",
  greeting: "first_mes",
  char_greeting: "first_mes",
  mes_example: "mes_example",
  example_dialogue: "mes_example",
  example_dialogs: "mes_example",
  creator: "creator",
  author: "creator",
  creator_notes: "creator_notes",
  notes: "creator_notes",
  tags: "tags",
};

function parseJson(text: string): ParsedCardText | null {
  if (!/^\s*[{[]/.test(text)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  // Tavern V2 nests everything under `data`; merge it over the outer object.
  const outer = parsed as Record<string, unknown>;
  const inner = outer.data && typeof outer.data === "object" && !Array.isArray(outer.data)
    ? (outer.data as Record<string, unknown>)
    : {};
  const merged: Record<string, unknown> = { ...outer, ...inner };
  delete merged.data;

  const fields: Partial<Record<CardField, string>> = {};
  const tags: string[] = [];
  const leftovers: string[] = [];
  const notes: string[] = ["Read as a JSON card export."];

  for (const [key, value] of Object.entries(merged)) {
    if (value == null || value === "") continue;
    const target = JSON_KEY_MAP[key.toLowerCase()];

    if (target === "tags") {
      if (Array.isArray(value)) tags.push(...value.map(String));
      else if (typeof value === "string") tags.push(...splitTags(value));
      continue;
    }

    const asText = stringifyValue(value);
    if (!asText) continue;

    if (target) {
      fields[target] = fields[target] ? fields[target] + "\n\n" + asText : asText;
    } else {
      // Every unmapped key lands here, arrays and objects included. They used to
      // be dropped: stringifyValue returned "" for objects, and this branch only
      // accepted scalars — so a full Tavern V2 paste silently lost its alternate
      // greetings, lorebook, and extensions, while the note claimed one field.
      leftovers.push(`${prettyKey(key)}: ${asText}`);
    }
  }

  if (leftovers.length) {
    fields.description = joinSections(fields.description, leftovers.join("\n"));
    notes.push(`Kept ${leftovers.length} unrecognised field${leftovers.length === 1 ? "" : "s"} in Description.`);
  }

  if (!Object.keys(fields).length && !tags.length) return null;
  return { fields, tags, method: "json", notes };
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    // An array of plain values reads best one per line; anything structured
    // keeps its shape so the user can see what they had.
    const simple = value.every((v) => typeof v !== "object" || v === null);
    return simple
      ? value.map(stringifyValue).filter(Boolean).join("\n")
      : JSON.stringify(value, null, 2);
  }
  if (value && typeof value === "object") {
    // Nested blocks — a character_book, an extensions bag — are kept verbatim
    // rather than discarded. The user can decide what to do with them.
    const json = JSON.stringify(value, null, 2);
    return json === "{}" ? "" : json;
  }
  return "";
}

function prettyKey(key: string): string {
  return key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Strategy 2: W++ / attribute lists ───────────────────────────────────────
// Personality("cheerful" + "loyal")  |  Appearance("tall", "silver hair")

/**
 * `Label("a" + "b")`. The body must be quoted strings joined by `+` or `,` —
 * nothing else. An earlier version accepted any `word(...)`, which matched
 * ordinary English parentheticals like "he works (nights) at the docks", and
 * since this strategy builds its result purely from matches, everything outside
 * them was silently discarded. Quotes may contain parentheses of their own,
 * which the old body pattern also truncated on.
 */
const WPP_BLOCK_RE = /([A-Za-z][A-Za-z _-]{0,28}?)\s*[({[]\s*((?:"[^"]*"\s*[+,]?\s*)+)[)}\]]/g;

/** Below this, the text is prose that happens to contain a quoted list. */
const WPP_MIN_COVERAGE = 0.6;

function parseWpp(text: string): ParsedCardText | null {
  const fields: Partial<Record<CardField, string>> = {};
  const tags: string[] = [];
  const leftovers: string[] = [];
  let matched = 0;
  let covered = 0;
  /** Character spans the attribute blocks occupy, so the rest can be kept. */
  const spans: Array<[number, number]> = [];

  for (const m of text.matchAll(WPP_BLOCK_RE)) {
    const rawLabel = m[1].trim();
    const values = [...m[2].matchAll(/"([^"]*)"/g)].map((v) => v[1].trim()).filter(Boolean);
    if (!values.length) continue;

    matched++;
    covered += m[0].length;
    spans.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);

    const joined = values.join(", ");
    const target = lookupLabel(rawLabel);
    if (target === "tags") {
      tags.push(...values);
    } else if (target) {
      fields[target] = fields[target] ? fields[target] + ", " + joined : joined;
    } else {
      leftovers.push(`${prettyKey(rawLabel)}: ${joined}`);
    }
  }

  if (matched < 2) return null;

  // A real W++ card is almost entirely attribute blocks. If most of the text
  // sits outside them, this is prose and another strategy should keep it all.
  const meaningful = text.replace(/\s+/g, " ").trim().length;
  if (!meaningful || covered / meaningful < WPP_MIN_COVERAGE) return null;

  // Text between the blocks — a preamble, a stray sentence — is content the
  // author wrote, and this parser promises to keep everything it is given.
  const outside: string[] = [];
  let cursor = 0;
  for (const [start, end] of spans) {
    if (start > cursor) outside.push(text.slice(cursor, start));
    cursor = Math.max(cursor, end);
  }
  outside.push(text.slice(cursor));
  const remainder = outside.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  const notes = ["Read as a W++ / attribute list."];
  if (remainder) {
    fields.description = joinSections(fields.description, remainder);
    notes.push("Kept the text outside the attribute blocks in Description.");
  }
  if (leftovers.length) {
    fields.description = joinSections(fields.description, leftovers.join("\n"));
    notes.push(`Kept ${leftovers.length} unrecognised attribute${leftovers.length === 1 ? "" : "s"} in Description.`);
  }

  return { fields, tags, method: "wpp", notes };
}

// ── Strategy 3: labelled sections ───────────────────────────────────────────

interface Heading {
  target: LabelTarget | null;
  /** Original label text, kept so unrecognised sections stay readable. */
  rawLabel: string;
  /** Content that appeared on the same line, after the separator. */
  inline: string;
}

/**
 * A rule/divider line — `⸻`, `───`, `---`, `***`, `===`. Card authors use these
 * between sections; they're never content, and left in place they end up
 * embedded in whatever field the section belongs to.
 */
const SEPARATOR_RE = /^[\s⸻—–─-╿=*_~•·—–-]+$/;

export function isSeparatorLine(line: string): boolean {
  const t = line.trim();
  // Two-plus repeated rule characters, or a single long-dash glyph on its own.
  return t.length > 0 && SEPARATOR_RE.test(t) && (t.length >= 2 || /[⸻─-╿]/.test(t));
}

/** `* item`, `- item`, `1. item` — list content, never a section heading. */
function isBulletLine(line: string): boolean {
  return /^\s*([*+•·-]|\d+[.)])\s+/.test(line);
}

/**
 * `{{char}}: ...`, `{{user}}: ...`, `<BOT>: ...` — a speaker in an example
 * exchange, not a section heading. Without this guard `{{char}}` normalises to
 * "char", which is a Name alias, so every line of example dialogue would open a
 * new Name section and shred the block.
 */
const DIALOGUE_SPEAKER_RE = /^\s*(\{\{[^}]*\}\}|<\s*\/?\s*[a-z]+\s*>)\s*:/i;

function isDialogueLine(line: string): boolean {
  return DIALOGUE_SPEAKER_RE.test(line);
}

/**
 * Decide whether a line opens a new section. Accepts `Label:`, markdown/bracket
 * decoration, or a bare line that is *exactly* a known section word — the shape
 * used by most hand-written cards, where `Appearance` sits alone above its
 * paragraphs. Bare matching is restricted to the known vocabulary and excludes
 * list items, so prose like "History repeats itself" or a bullet reading
 * "* Philosophy" can't be mistaken for a heading.
 */
function matchHeading(line: string): Heading | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (isSeparatorLine(trimmed)) return null;
  if (isDialogueLine(trimmed)) return null;

  // [Label] or <Label> or (Label), alone on the line
  const bracket = trimmed.match(/^[[<(]\s*([^\]>)]{1,40}?)\s*[\]>)]\s*[:\-–—]?\s*(.*)$/);
  if (bracket) {
    const target = lookupLabel(bracket[1]);
    if (target) return { target, rawLabel: bracket[1].trim(), inline: bracket[2].trim() };
  }

  const bare = trimmed.replace(/^[#>*_\-–—•\s]+/, "");

  // Label: content   (the common case)
  const colon = bare.match(/^([^:：\n]{1,40}?)\s*[:：]\s*(.*)$/);
  if (colon) {
    const target = lookupLabel(colon[1]);
    if (target) return { target, rawLabel: colon[1].trim(), inline: colon[2].trim() };
    // Unrecognised but clearly a label — keep it so the text isn't lost.
    if (isLabelShaped(colon[1])) return { target: null, rawLabel: colon[1].trim(), inline: colon[2].trim() };
  }

  // ## Label, **Label**, or a bare `Appearance` on its own line.
  // Bullets are excluded so a list item like "* Philosophy" stays content.
  if (!isBulletLine(trimmed)) {
    const stripped = bare.replace(/[*_#`:：]+$/, "").trim();
    if (stripped.length <= 32 && !/[.!?,;]/.test(stripped)) {
      const target = lookupLabel(stripped);
      if (target) return { target, rawLabel: stripped, inline: "" };
    }
  }

  return null;
}

/** A short, title-ish run of words with no sentence punctuation. */
function isLabelShaped(candidate: string): boolean {
  const t = candidate.trim().replace(/[*_#`]/g, "");
  if (!t || t.length > 32) return false;
  if (/[.!?,;]/.test(t)) return false;
  const words = t.split(/\s+/);
  return words.length <= 4 && /^[A-Za-z]/.test(t);
}

function parseLabelled(text: string): ParsedCardText | null {
  const lines = text.split("\n");
  const sections: Array<{ heading: Heading; body: string[] }> = [];
  const preamble: string[] = [];
  let recognised = 0;

  for (const line of lines) {
    if (isSeparatorLine(line)) continue; // divider rules are never content
    const heading = matchHeading(line);
    if (heading) {
      if (heading.target) recognised++;
      sections.push({ heading, body: heading.inline ? [heading.inline] : [] });
    } else if (sections.length) {
      sections[sections.length - 1].body.push(line);
    } else {
      preamble.push(line);
    }
  }

  // One lone label isn't enough structure to trust — fall through to prose.
  if (recognised < 2) return null;

  const fields: Partial<Record<CardField, string>> = {};
  const tags: string[] = [];
  const leftovers: string[] = [];

  for (const { heading, body } of sections) {
    const content = body.join("\n").trim();
    if (!content) continue;

    if (heading.target === "tags") {
      tags.push(...splitTags(content));
    } else if (heading.target) {
      // Several sections can land in one field — Habits, Interests, Strengths and
      // Flaws all belong to Personality. Keep each one's own label so the merged
      // field stays readable instead of becoming an undifferentiated wall.
      const existing = fields[heading.target];
      const secondary = existing && normaliseLabel(heading.rawLabel) !== heading.target;
      fields[heading.target] = joinSections(existing, secondary ? `${heading.rawLabel.trim()}:\n${content}` : content);
    } else {
      leftovers.push(`${heading.rawLabel}: ${content}`);
    }
  }

  const notes = ["Split on the labels found in your text."];

  // Text before the first heading is usually a name or a lead-in blurb.
  const lead = preamble.join("\n").trim();
  if (lead) {
    if (!fields.name && isNameLike(lead)) {
      fields.name = lead;
      notes.push("Took the first line as the persona name.");
    } else {
      fields.description = joinSections(lead, fields.description);
    }
  }

  if (leftovers.length) {
    fields.description = joinSections(fields.description, leftovers.join("\n\n"));
    notes.push(`Kept ${leftovers.length} unrecognised section${leftovers.length === 1 ? "" : "s"} in Description.`);
  }

  return { fields, tags, method: "labelled", notes };
}

// ── Strategy 4: unstructured prose ──────────────────────────────────────────

function parseProse(text: string): ParsedCardText {
  const fields: Partial<Record<CardField, string>> = {};
  const notes: string[] = [];

  let body = text;

  // A short opening line with no sentence punctuation is almost always a name.
  const firstBreak = body.indexOf("\n");
  if (firstBreak > 0) {
    const first = body.slice(0, firstBreak).trim();
    if (isNameLike(first)) {
      fields.name = first.replace(/[*_#]/g, "").trim();
      body = body.slice(firstBreak + 1).trim();
      notes.push("Took the first line as the persona name.");
    }
  }

  const chunks = splitForClassification(body);
  const buckets: Record<"description" | "personality" | "appearance" | "background", string[]> = {
    description: [],
    personality: [],
    appearance: [],
    background: [],
  };

  for (const chunk of chunks) {
    buckets[classifyChunk(chunk)].push(chunk);
  }

  for (const key of ["description", "personality", "appearance", "background"] as const) {
    const joined = buckets[key].join("\n\n").trim();
    if (joined) fields[key] = joinSections(fields[key], joined);
  }

  notes.unshift(
    "No labels found, so the text was sorted by what each part talks about. Check the split before applying — this is a best guess."
  );

  return { fields, tags: [], method: "prose", notes };
}

/** Prefer paragraphs; fall back to sentences when it's one solid block. */
function splitForClassification(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length > 1) return paragraphs;

  const single = paragraphs[0] ?? text.trim();
  if (!single) return [];

  const lines = single.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 2) return lines;

  const sentences = single.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  return sentences.length > 1 ? sentences : [single];
}

function classifyChunk(chunk: string): "description" | "personality" | "appearance" | "background" {
  const scores = {
    appearance: scoreWords(chunk, APPEARANCE_WORDS),
    personality: scoreWords(chunk, PERSONALITY_WORDS),
    background: scoreWords(chunk, BACKGROUND_WORDS),
  };

  const best = (Object.keys(scores) as Array<keyof typeof scores>).reduce((a, b) =>
    scores[b] > scores[a] ? b : a
  );

  // Require a clear winner — a single stray keyword shouldn't move a paragraph.
  const others = (Object.keys(scores) as Array<keyof typeof scores>).filter((k) => k !== best);
  const runnerUp = Math.max(...others.map((k) => scores[k]));
  if (scores[best] >= 2 && scores[best] > runnerUp) return best;

  return "description";
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function isNameLike(candidate: string): boolean {
  const t = candidate.trim().replace(/[*_#]/g, "").trim();
  if (!t || t.length > 48) return false;
  if (/[.!?;:]/.test(t)) return false;
  return t.split(/\s+/).length <= 5;
}

function splitTags(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((t) => t.trim().replace(/^[#\-*•]\s*/, ""))
    .filter(Boolean);
}

/**
 * Fold a parse result into character-card fields.
 *
 * Character cards have no appearance or background field of their own — that
 * detail conventionally lives in description — so those sections are merged in
 * with their labels kept, rather than being dropped on the floor.
 */
export function toCharacterFields(parsed: ParsedCardText): Partial<Record<CardField, string>> {
  const out: Partial<Record<CardField, string>> = {};

  for (const field of CHARACTER_FIELD_ORDER) {
    const value = (parsed.fields[field] ?? "").trim();
    if (value) out[field] = value;
  }

  const folded: string[] = [];
  for (const [field, label] of [["appearance", "Appearance"], ["background", "Background"]] as const) {
    const value = (parsed.fields[field] ?? "").trim();
    if (value) folded.push(`${label}:\n${value}`);
  }
  if (folded.length) out.description = joinSections(out.description, folded.join("\n\n"));

  return out;
}

function joinSections(a: string | undefined, b: string | undefined): string {
  const left = (a ?? "").trim();
  const right = (b ?? "").trim();
  if (!left) return right;
  if (!right) return left;
  return left + "\n\n" + right;
}

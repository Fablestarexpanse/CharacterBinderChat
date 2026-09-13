// ─── The Drawer 2 extraction prompt ───────────────────────────────────────────
// Kept beside episodePrompts.ts rather than inside the extractor: the prompt is
// the part that gets rewritten and compared across runs, and it has no
// dependency on the store or the writes.

import type { MessageRole } from "@/lib/types";

export interface ExtractionPromptInput {
  messages:       Array<{ role: MessageRole; content: string; speaker?: string }>;
  characterName:  string;
  characterId:    string;
  /** Display name for the human side of the conversation */
  userLabel:      string;
  /** Entity id for the human side — the anchor the model must reuse */
  userId:         string;
  /** Existing entities, so the model reuses ids instead of minting new ones */
  knownEntities:  Array<{ id: string; name: string; type: string }>;
  /** Everyone in the scene, for group chats */
  participants:   Array<{ id: string; name: string }>;
}

export function buildExtractionPrompt({
  messages, characterName, characterId, userLabel, userId,
  knownEntities, participants,
}: ExtractionPromptInput): string {
  // Group messages carry an explicit speaker label; 1:1 falls back to role
  const conversation = messages
    .slice(-12)
    .map((m) => `${m.speaker ?? (m.role === "user" ? userLabel : characterName)}: ${m.content}`)
    .join("\n\n");

  // ── Identity anchor ───────────────────────────────────────────────────────
  // The participants already have ids in the database. Without stating
  // them the model mints its own ("ronan" next to "char-ronan"), and every
  // fact about the protagonist lands on an entity nothing ever reads back.
  const others = participants.filter((p) => p.id !== characterId && p.id !== userId);
  const anchorBlock = `PARTICIPANT IDS — these entities already exist. Use these exact ids as
subject/object/observer/target whenever the fact concerns them. Do NOT invent
alternative ids for them:
- ${characterId || "unknown"} = ${characterName} (the character speaking)
- ${userId} = ${userLabel} (the person they are talking to)
${others.map((p) => `- ${p.id} = ${p.name} (also present in the scene)`).join("\n")}

`;

  // ── Entity roster ─────────────────────────────────────────────────────────
  const rosterBlock = knownEntities.length > 0
    ? `EXISTING ENTITIES — reuse these exact ids when an entity reappears; only mint a
new snake_case id for an entity not in this list:
${knownEntities.slice(0, 40).map((e) => `- ${e.id} (${e.type}) "${e.name}"`).join("\n")}

`
    : "";

  return `You are a memory extraction assistant for a roleplay story. Extract structured information from the conversation below.

Return ONLY valid JSON. No markdown, no explanation, just the JSON object.

{
  "entities": [
    { "id": "snake_case_id", "type": "character|place|object|faction|concept", "name": "Display Name", "description": "Brief description" }
  ],
  "facts": [
    { "subject": "entity_id", "predicate": "lives_at", "object": "entity_id or literal string", "confidence": 0.9, "importance": 0.8 }
  ],
  "stat_changes": [
    { "observer": "entity_id", "target": "entity_id", "stat": "affection|trust|desire|connection", "delta": 5 }
  ],
  "commitments": [
    { "promisor": "entity_id", "promisee": "entity_id", "description": "what was promised, concretely, with any deadline" }
  ],
  "resolved_commitments": [
    { "match": "distinctive words from the earlier promise", "status": "fulfilled|broken" }
  ],
  "shared_language": [
    { "kind": "nickname|joke|ritual|phrase", "text": "the running bit, in a few words" }
  ],
  "story_time": "current in-fiction time as a short phrase, or null"
}

IMPORTANCE (0.0-1.0) — how much this fact matters to the story and relationship,
independent of how certain it is:
- 0.8-1.0: identity, kinship, fears, promises, betrayals, deaths, debts
- 0.4-0.7: occupations, homes, standing relationships, significant possessions
- 0.1-0.3: scenery, passing objects, small talk detail
Do NOT create entities for incidental props, weather, or abstractions
(cobblestones, darkness, a coin pouch). An entity must be something the story
could return to.

COMMITMENTS — capture promises, oaths, debts and deadlines as commitments, not
just facts. When a conversation shows an earlier promise being kept or broken,
emit a resolved_commitments entry instead of a new commitment.
Commitments are for stakes the story could hold someone to. Playful banter,
running jokes, teasing "deals" and pet rituals are NOT commitments — put those
in shared_language instead.

SHARED_LANGUAGE — nicknames, running jokes, little rituals, and pet phrases
these two have between them (a standing coffee order, a recurring bit, a name
only one of them uses). Emit each once, briefly; re-emit only if it appears
again in this excerpt.

STORY_TIME — the story's current in-fiction time, as a short phrase, whenever
the conversation states or clearly implies it ("Thursday evening", "the
morning after the storm", "an hour before the symposium"). null if unclear.

PREDICATE VOCABULARY — for these relationship kinds you MUST use the exact predicate
shown, never a synonym:
- where someone lives or resides   -> "lives_at"
- where something is located       -> "located_at"
- where someone works              -> "works_at"
- an entity's current place/base   -> "current_location"
- an entity's status or state      -> "status"
- identity ("X is Y")              -> "is"
For any OTHER relationship (knows, distrusts, owns, fears, promised, etc.) use a short
free-form snake_case predicate. Do NOT invent synonyms for the six above — write
"lives_at", never "resides at" / "is staying at" / "calls home" / "based out of".

FEW-SHOT EXAMPLES (assuming the character's id is "${characterId || "char_x"}"):
Turn 1 — "I live in the lower city safehouse."
  -> { "subject": "${characterId || "char_x"}", "predicate": "lives_at", "object": "lower city safehouse" }
Turn 2 — "I moved to Kaelen yesterday."
  -> { "subject": "${characterId || "char_x"}", "predicate": "lives_at", "object": "kaelen" }
(Same predicate "lives_at" both times, and the SAME subject id as the roster
gives — the new fact supersedes the old one.)

Rules:
- Only include entities actually mentioned or clearly implied
- Facts should be concrete statements: X knows Y, X lives_at Y, X distrusts Y
- stat_changes are for MEANINGFUL emotional shifts only. Most exchanges warrant
  NO stat change — ordinary pleasant conversation, small talk, and routine
  cooperation are all "stat_changes": []. Reserve deltas for moments that would
  genuinely move how someone feels: a confession, a sacrifice, a betrayal, a
  rescue, a gift, a wound. Magnitude: ±3-8 for notable moments, ±10-20 for major
  ones, beyond that only for story-defining events.
- Stats track what happened BETWEEN these two people, never the scene's
  atmosphere. A storm, an eerie street, danger from third parties, or a dark
  mood in the prose is NOT a relationship change — if neither person did
  anything to the other, emit no delta, however ominous the scene feels.
- stat_changes track how ${characterName} feels, so use observer
  "${characterId || "the character's id"}" and target "${userId}". Only use the
  reverse direction for a stat that is explicitly about the other person's feelings.${others.length > 0 ? `
  In this group scene, stat changes between ANY two listed participants are
  allowed when the conversation shows one — use their exact ids.` : ""}
- For an entity NOT already listed above, mint a new snake_case id from its name
  (e.g. "kaspar_division", "sector_7"). Never mint one for an entity that is
  already listed — reuse its id verbatim.
- If nothing meaningful to extract, return {"entities":[],"facts":[],"stat_changes":[]}

${anchorBlock}${rosterBlock}Conversation to analyze:
${conversation}`;
}

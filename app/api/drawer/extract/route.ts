import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { normPredicate, predicateFamily, isSingleValued } from "@/lib/db/predicates";
import { callOllama, callOpenAICompat, parseLLMJson } from "@/lib/llm/callers";
import { embedTexts, vecToBuffer } from "@/lib/llm/embeddings";
import { ensureCoreMemory, syncStatsToCore, syncCommitmentsToCore } from "@/lib/chat/coreMemoryStore";
import type { EntityType, StatName } from "@/lib/db/models";

export const dynamic = "force-dynamic";

// ─── Extraction Prompt ────────────────────────────────────────────────────────

function buildExtractionPrompt(
  messages:      Array<{ role: string; content: string }>,
  characterName: string,
  knownEntities: Array<{ id: string; name: string; type: string }> = [],
  userLabel     = "User",
  characterId   = "",
  userId        = "player"
): string {
  const conversation = messages
    .slice(-12)
    .map((m) => `${m.role === "user" ? userLabel : characterName}: ${m.content}`)
    .join("\n\n");

  // ── Identity anchor ───────────────────────────────────────────────────────
  // The two participants already have ids in the database. Without stating
  // them the model mints its own ("ronan" next to "char-ronan"), and every
  // fact about the protagonist lands on an entity nothing ever reads back.
  const anchorBlock = `PARTICIPANT IDS — these two entities already exist. Use these exact ids as
subject/object/observer/target whenever the fact concerns them. Do NOT invent
alternative ids for them:
- ${characterId || "unknown"} = ${characterName} (the character speaking)
- ${userId} = ${userLabel} (the person they are talking to)

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
  ]
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
  reverse direction for a stat that is explicitly about the other person's feelings.
- For an entity NOT already listed above, mint a new snake_case id from its name
  (e.g. "kaspar_division", "sector_7"). Never mint one for an entity that is
  already listed — reuse its id verbatim.
- If nothing meaningful to extract, return {"entities":[],"facts":[],"stat_changes":[]}

${anchorBlock}${rosterBlock}Conversation to analyze:
${conversation}`;
}

// ─── Extraction result shape ──────────────────────────────────────────────────

interface RawExtraction {
  entities:    Array<{ id: string; type: string; name: string; description?: string }>;
  facts:       Array<{ subject: string; predicate: string; object: string; confidence?: number; importance?: number }>;
  stat_changes:Array<{ observer: string; target: string; stat: string; delta: number }>;
  commitments?: Array<{ promisor: string; promisee?: string; description: string }>;
  resolved_commitments?: Array<{ match: string; status: string }>;
}

// ─── Entity identity resolution ───────────────────────────────────────────────
// Models drift off the roster no matter how the prompt is worded, emitting
// "theron" beside an existing "char-theron". Both describe the same person, but
// facts land on the invented id and retrieveFactsForPrompt(characterId) then
// reads an empty graph. Resolve incoming ids onto existing entities by name
// before anything is written, so drift can't fragment the graph.

const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

class EntityResolver {
  /** normalized name -> canonical entity id */
  private byName = new Map<string, string>();
  /** id the model used -> canonical entity id */
  private alias = new Map<string, string>();

  constructor(
    existing: Array<{ id: string; name: string }>,
    anchors: Array<{ id: string; name?: string }>
  ) {
    for (const e of existing) {
      const key = normKey(e.name);
      if (key && !this.byName.has(key)) this.byName.set(key, e.id);
    }
    // Anchors win: the character and player ids are authoritative even if some
    // other entity happens to share their display name.
    for (const a of anchors) {
      if (!a.name) continue;
      const key = normKey(a.name);
      if (key) this.byName.set(key, a.id);
      this.byName.set(normKey(a.id), a.id);
    }
  }

  /** Record that the model's `id` (with display `name`) means an existing entity */
  learn(id: string, name: string): string | null {
    const canonical = this.byName.get(normKey(name));
    if (canonical && canonical !== id) {
      this.alias.set(id, canonical);
      return canonical;
    }
    // New entity: register its name so later references resolve to it
    if (!canonical) this.byName.set(normKey(name), id);
    return null;
  }

  /**
   * Map an id the model emitted onto the canonical one. Falls back to matching
   * the id itself as a name, which catches bare references like subject
   * "theron" that never appeared in the entities array.
   */
  resolve(id: string): string {
    return this.alias.get(id) ?? this.byName.get(normKey(id)) ?? id;
  }

  get remapped(): Array<[string, string]> {
    return [...this.alias.entries()];
  }
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      messages,
      chatId,
      characterId,
      characterName,
      personaName,
      providerType,
      providerBaseUrl,
      modelId,
      apiKey,
    } = body as {
      messages:        Array<{ role: string; content: string }>;
      chatId:          string;
      characterId:     string;
      characterName:   string;
      personaName?:    string;
      providerType:    "ollama" | "lmstudio" | "openrouter";
      providerBaseUrl: string;
      modelId:         string;
      apiKey?:         string;
    };

    if (!messages?.length || !chatId || !characterId || !providerBaseUrl || !modelId) {
      return Response.json(
        { error: "messages, chatId, characterId, providerBaseUrl and modelId are required" },
        { status: 400 }
      );
    }

    // ── Build prompt with known entity roster (prevents ID drift) ────────────

    const store = getStore();

    // Keep the "player" entity named after the active persona so the graph
    // and the conversation labels agree on who the user is.
    const player = store.getEntity(chatId, "player");
    if (personaName && player && player.name !== personaName) {
      store.insertEntity(chatId, { ...player, name: personaName });
    } else if (personaName && !player) {
      store.ensureEntity(chatId, "player", "character", personaName, "The user");
    }

    // The character must exist before the roster is built so the prompt can
    // anchor on its real id
    store.ensureEntity(chatId, characterId, "character", characterName ?? characterId);

    const knownEntities = store.listEntities(chatId).map((e) => ({
      id: e.id, name: e.name, type: e.type,
    }));
    const prompt = buildExtractionPrompt(
      messages, characterName ?? characterId, knownEntities, personaName ?? "User",
      characterId, "player"
    );

    // ── Call LLM ──────────────────────────────────────────────────────────

    let rawText: string;

    if (providerType === "ollama") {
      rawText = await callOllama(providerBaseUrl, modelId, prompt);
    } else {
      rawText = await callOpenAICompat(providerBaseUrl, modelId, prompt, apiKey);
    }

    // Parse failure must be distinguishable from "nothing to extract" — an
    // empty-object fallback here would make a model that can't emit JSON look
    // identical to a quiet conversation, and nothing would ever reach the DB.
    const extracted = parseLLMJson<RawExtraction | null>(rawText, null);
    if (!extracted) {
      console.warn("[drawer/extract] unparseable LLM output:", rawText.slice(0, 300));
      return Response.json(
        {
          ok:       false,
          error:    "model returned unparseable JSON — nothing extracted",
          rawModel: rawText.slice(0, 200) + (rawText.length > 200 ? "…" : ""),
        },
        { status: 502 }
      );
    }

    // ── Resolve model-minted ids onto existing entities ───────────────────

    const resolver = new EntityResolver(knownEntities, [
      { id: characterId, name: characterName ?? characterId },
      { id: "player",    name: personaName },
    ]);

    // ── Write extracted entities ──────────────────────────────────────────
    // An entity whose name matches one already in the graph is not created;
    // its id is aliased instead, so the graph never gains a twin.

    const writtenEntities: string[] = [];
    for (const e of extracted.entities ?? []) {
      if (!e.id || !e.name) continue;
      if (resolver.learn(e.id, e.name)) continue; // aliased to an existing entity
      const validTypes = ["character", "place", "object", "faction", "concept"];
      const type = validTypes.includes(e.type) ? (e.type as EntityType) : "character";
      store.ensureEntity(chatId, e.id, type, e.name, e.description ?? "");
      writtenEntities.push(e.id);
    }

    // ── Write extracted facts ─────────────────────────────────────────────
    // Strategy per fact:
    // 1. Query existing live facts for this subject ONCE.
    // 2. If an identical live fact already exists (same predicate + same object),
    //    skip the insert entirely — prevents unbounded duplicate accumulation.
    // 3. For single-valued predicates, identify contradicting facts to supersede.
    // 4. Insert the new fact, then supersede the contradicting ones.

    const writtenFacts: number[] = [];
    for (const raw of extracted.facts ?? []) {
      if (!raw.subject || !raw.predicate || !raw.object) continue;

      // Route the fact onto canonical entities before anything is written
      const f = {
        ...raw,
        subject: resolver.resolve(raw.subject),
        object:  resolver.resolve(raw.object),
      };

      if (!store.getEntity(chatId, f.subject)) {
        store.ensureEntity(chatId, f.subject, "character", f.subject);
      }

      const objectEntity  = store.getEntity(chatId, f.object);
      const incomingNorm  = normPredicate(f.predicate);
      // Compare by family so drift between lives_at / located_at /
      // current_location still supersedes instead of accumulating.
      const incomingFamily = predicateFamily(f.predicate);
      const singleValued   = isSingleValued(f.predicate);
      const newObjectKey  = objectEntity ? f.object : f.object.toLowerCase().trim();

      // Single query for all existing live facts for this subject
      const existingFacts = store.queryFacts(chatId, f.subject);

      // Skip if an equivalent live fact already exists (dedup)
      const isDuplicate = existingFacts.some((ex) => {
        if (predicateFamily(ex.predicate) !== incomingFamily) return false;
        const exKey = ex.objectId ?? (ex.objectLiteral ?? "").toLowerCase().trim();
        return exKey === newObjectKey;
      });
      if (isDuplicate) continue;

      // Collect facts to supersede (single-valued family, different object)
      const toSupersede = singleValued
        ? existingFacts.filter((ex) => {
            if (predicateFamily(ex.predicate) !== incomingFamily) return false;
            const exKey = ex.objectId ?? (ex.objectLiteral ?? "").toLowerCase().trim();
            return exKey !== newObjectKey;
          })
        : [];

      const newFactId = store.insertFact(chatId, {
        subjectId:     f.subject,
        predicate:     incomingNorm,
        objectId:      objectEntity ? f.object : null,
        objectLiteral: objectEntity ? null : f.object,
        confidence:    f.confidence ?? 0.85,
        importance:    typeof f.importance === "number" ? f.importance : 0.5,
      });
      writtenFacts.push(newFactId);

      for (const old of toSupersede) {
        store.supersedeFact(old.id, newFactId);
      }
    }

    // ── Write stat changes ────────────────────────────────────────────────

    // Relationship stats only — mood lives in Drawer 1 (VAD), and letting the
    // model write a "mood" stat row produced a stray -11 in the Tilly soak.
    const writtenStats: string[] = [];
    const validStats = ["affection", "trust", "desire", "connection"];
    for (const rawSc of extracted.stat_changes ?? []) {
      if (!rawSc.observer || !rawSc.target || !validStats.includes(rawSc.stat)) continue;
      if (typeof rawSc.delta !== "number") continue;

      const sc = {
        ...rawSc,
        observer: resolver.resolve(rawSc.observer),
        target:   resolver.resolve(rawSc.target),
      };

      store.ensureEntity(chatId, sc.observer, "character", sc.observer);
      store.ensureEntity(chatId, sc.target,   "character", sc.target);
      store.deltaStat(chatId, sc.observer, sc.target, sc.stat as StatName, sc.delta);
      writtenStats.push(`${sc.observer}->${sc.target}:${sc.stat}(${sc.delta > 0 ? "+" : ""}${sc.delta})`);
    }

    // ── Embed the new facts for semantic retrieval ────────────────────────
    // Best-effort: null when local embeddings are unavailable, and retrieval
    // falls back to lexical ranking for un-embedded facts.
    const foldedFacts: number[] = [];
    if (writtenFacts.length > 0) {
      const byId = new Map(store.queryAllLiveFacts(chatId).map((f) => [f.id, f]));
      const factTexts = writtenFacts.map((id) => {
        const f = byId.get(id);
        return f ? `${f.subjectId} ${f.predicate} ${f.objectId ?? f.objectLiteral ?? ""}` : "";
      });
      const vecs = await embedTexts(factTexts);
      if (vecs) {
        const newIds = new Set(writtenFacts);
        writtenFacts.forEach((id, i) => {
          const vec = vecs[i];
          if (!vec) return;
          store.setFactEmbedding(id, vecToBuffer(vec));
          // Semantic dedupe: a restatement of an existing fact ("trusts Kael
          // deeply" next to "has deep trust in Kael") passes the exact-key
          // check above but adds no information — it only steals a prompt
          // slot. Fold it into the older fact instead of keeping both.
          const f = byId.get(id);
          if (f) {
            const dupOf = store.findSimilarLiveFact(chatId, f.subjectId, vec, newIds);
            if (dupOf !== null) {
              store.supersedeFact(id, dupOf);
              foldedFacts.push(id);
            }
          }
        });
      }
    }

    // ── Write commitments ─────────────────────────────────────────────────
    // Promises are what players most expect a character to hold onto; the
    // commitments table sat empty until the longitudinal soak proved a planted
    // deadline was never captured anywhere.

    const writtenCommitments: string[] = [];
    for (const rawC of extracted.commitments ?? []) {
      if (!rawC.promisor || !rawC.description?.trim()) continue;
      const promisor = resolver.resolve(rawC.promisor);
      const promisee = rawC.promisee ? resolver.resolve(rawC.promisee) : undefined;
      store.ensureEntity(chatId, promisor, "character", promisor);
      if (promisee) store.ensureEntity(chatId, promisee, "character", promisee);

      // Dedup on near-identical description among active commitments
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
      const dup = store.allCommitments(chatId, "active")
        .some((c) => norm(c.description) === norm(rawC.description));
      if (dup) continue;

      store.insertCommitment(chatId, promisor, rawC.description.trim(), promisee);
      writtenCommitments.push(rawC.description.trim());
    }

    for (const res of extracted.resolved_commitments ?? []) {
      if (!res.match?.trim() || !["fulfilled", "broken"].includes(res.status)) continue;
      const words = res.match.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      if (words.length === 0) continue;
      // Best overlap match among active commitments
      const active = store.allCommitments(chatId, "active");
      let best: { id: number; score: number } | null = null;
      for (const c of active) {
        const desc = c.description.toLowerCase();
        const score = words.filter((w) => desc.includes(w)).length / words.length;
        if (score >= 0.5 && (!best || score > best.score)) best = { id: c.id, score };
      }
      if (best) {
        store.updateCommitmentStatus(chatId, best.id, res.status as "fulfilled" | "broken");
      }
    }

    // ── Mirror Drawer-2 stats into the Core Memory Block (Drawer 1) ────────
    // Without this, relationship_with_user stays at its 50-neutral defaults
    // and buildSystemPrompt never emits the [Relationship with User] line.
    // Run unconditionally so pre-existing stat drift is backfilled too.
    ensureCoreMemory(chatId, characterId, characterName ?? characterId);
    syncStatsToCore(chatId, characterId);
    syncCommitmentsToCore(chatId, characterId, personaName ?? "the user");

    return Response.json({
      ok:          true,
      entities:    writtenEntities,
      facts:       writtenFacts.filter((id) => !foldedFacts.includes(id)),
      // Restatements folded into an existing fact by embedding similarity
      folded:      foldedFacts.length,
      stats:       writtenStats,
      commitments: writtenCommitments,
      // Which model-minted ids were folded onto existing entities. A large or
      // growing list means the prompt's identity anchoring is losing.
      remapped: resolver.remapped.map(([from, to]) => `${from}->${to}`),
      rawModel: rawText.slice(0, 200) + (rawText.length > 200 ? "…" : ""),
    });
  } catch (err) {
    console.error("[drawer/extract]", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

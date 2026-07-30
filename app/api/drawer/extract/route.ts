import { NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { SINGLE_VALUED_PREDICATES, normPredicate } from "@/lib/db/predicates";
import { callOllama, callOpenAICompat, parseLLMJson } from "@/lib/llm/callers";
import { ensureCoreMemory, syncStatsToCore } from "@/lib/chat/coreMemoryStore";
import type { EntityType, StatName } from "@/lib/db/models";

export const dynamic = "force-dynamic";

// ─── Extraction Prompt ────────────────────────────────────────────────────────

function buildExtractionPrompt(
  messages:      Array<{ role: string; content: string }>,
  characterName: string,
  knownEntities: Array<{ id: string; name: string; type: string }> = [],
  userLabel     = "User"
): string {
  const conversation = messages
    .slice(-12)
    .map((m) => `${m.role === "user" ? userLabel : characterName}: ${m.content}`)
    .join("\n\n");

  // ── Entity roster (Task 2) ────────────────────────────────────────────────
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
    { "subject": "entity_id", "predicate": "lives_at", "object": "entity_id or literal string", "confidence": 0.9 }
  ],
  "stat_changes": [
    { "observer": "entity_id", "target": "entity_id", "stat": "affection|trust|desire|connection|mood", "delta": 5 }
  ]
}

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

FEW-SHOT EXAMPLES (location change across turns):
Turn 1 — "I live in the lower city safehouse."
  -> { "subject": "ronan", "predicate": "lives_at", "object": "lower city safehouse" }
Turn 2 — "Ronan moved to Kaelen yesterday."
  -> { "subject": "ronan", "predicate": "lives_at", "object": "kaelen" }
(Same predicate "lives_at" both times; the new fact supersedes the old one.)

Rules:
- Only include entities actually mentioned or clearly implied
- Facts should be concrete statements: X knows Y, X lives_at Y, X distrusts Y
- stat_changes reflect emotional/relational shifts; delta range -30 to +30 per exchange
- observer is the entity whose feelings/perspective is being tracked
- Use snake_case IDs derived from names (e.g. "ronan", "kaspar_division", "sector_7")
- If nothing meaningful to extract, return {"entities":[],"facts":[],"stat_changes":[]}

${rosterBlock}Conversation to analyze:
${conversation}`;
}

// ─── Extraction result shape ──────────────────────────────────────────────────

interface RawExtraction {
  entities:    Array<{ id: string; type: string; name: string; description?: string }>;
  facts:       Array<{ subject: string; predicate: string; object: string; confidence?: number }>;
  stat_changes:Array<{ observer: string; target: string; stat: string; delta: number }>;
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      messages,
      characterId,
      characterName,
      personaName,
      providerType,
      providerBaseUrl,
      modelId,
      apiKey,
    } = body as {
      messages:        Array<{ role: string; content: string }>;
      characterId:     string;
      characterName:   string;
      personaName?:    string;
      providerType:    "ollama" | "lmstudio" | "openrouter";
      providerBaseUrl: string;
      modelId:         string;
      apiKey?:         string;
    };

    if (!messages?.length || !characterId || !providerBaseUrl || !modelId) {
      return Response.json(
        { error: "messages, characterId, providerBaseUrl and modelId are required" },
        { status: 400 }
      );
    }

    // ── Build prompt with known entity roster (prevents ID drift) ────────────

    const store = getStore();

    // Keep the "player" entity named after the active persona so the graph
    // and the conversation labels agree on who the user is.
    const player = store.getEntity("player");
    if (personaName && player && player.name !== personaName) {
      store.insertEntity({ ...player, name: personaName });
    } else if (personaName && !player) {
      store.ensureEntity("player", "character", personaName, "The user");
    }

    const knownEntities = store.listEntities().map((e) => ({
      id: e.id, name: e.name, type: e.type,
    }));
    const prompt = buildExtractionPrompt(
      messages, characterName ?? characterId, knownEntities, personaName ?? "User"
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

    // ── Ensure the main character entity exists ───────────────────────────

    store.ensureEntity(characterId, "character", characterName ?? characterId);

    // ── Write extracted entities ──────────────────────────────────────────

    const writtenEntities: string[] = [];
    for (const e of extracted.entities ?? []) {
      if (!e.id || !e.name) continue;
      const validTypes = ["character", "place", "object", "faction", "concept"];
      const type = validTypes.includes(e.type) ? (e.type as EntityType) : "character";
      store.ensureEntity(e.id, type, e.name, e.description ?? "");
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
    for (const f of extracted.facts ?? []) {
      if (!f.subject || !f.predicate || !f.object) continue;

      if (!store.getEntity(f.subject)) {
        store.ensureEntity(f.subject, "character", f.subject);
      }

      const objectEntity  = store.getEntity(f.object);
      const incomingNorm  = normPredicate(f.predicate);
      const isSingleValued = SINGLE_VALUED_PREDICATES.has(incomingNorm);
      const newObjectKey  = objectEntity ? f.object : f.object.toLowerCase().trim();

      // Single query for all existing live facts for this subject
      const existingFacts = store.queryFacts(f.subject);

      // Skip if an identical live fact already exists (dedup)
      const isDuplicate = existingFacts.some((ex) => {
        if (normPredicate(ex.predicate) !== incomingNorm) return false;
        const exKey = ex.objectId ?? (ex.objectLiteral ?? "").toLowerCase().trim();
        return exKey === newObjectKey;
      });
      if (isDuplicate) continue;

      // Collect facts to supersede (single-valued predicate, different object)
      const toSupersede = isSingleValued
        ? existingFacts.filter((ex) => {
            if (normPredicate(ex.predicate) !== incomingNorm) return false;
            const exKey = ex.objectId ?? (ex.objectLiteral ?? "").toLowerCase().trim();
            return exKey !== newObjectKey;
          })
        : [];

      const newFactId = store.insertFact({
        subjectId:     f.subject,
        predicate:     incomingNorm,
        objectId:      objectEntity ? f.object : null,
        objectLiteral: objectEntity ? null : f.object,
        confidence:    f.confidence ?? 0.85,
      });
      writtenFacts.push(newFactId);

      for (const old of toSupersede) {
        store.supersedeFact(old.id, newFactId);
      }
    }

    // ── Write stat changes ────────────────────────────────────────────────

    const writtenStats: string[] = [];
    const validStats = ["affection", "trust", "desire", "connection", "mood"];
    for (const sc of extracted.stat_changes ?? []) {
      if (!sc.observer || !sc.target || !validStats.includes(sc.stat)) continue;
      if (typeof sc.delta !== "number") continue;

      store.ensureEntity(sc.observer, "character", sc.observer);
      store.ensureEntity(sc.target,   "character", sc.target);
      store.deltaStat(sc.observer, sc.target, sc.stat as StatName, sc.delta);
      writtenStats.push(`${sc.observer}->${sc.target}:${sc.stat}(${sc.delta > 0 ? "+" : ""}${sc.delta})`);
    }

    // ── Mirror Drawer-2 stats into the Core Memory Block (Drawer 1) ────────
    // Without this, relationship_with_user stays at its 50-neutral defaults
    // and buildSystemPrompt never emits the [Relationship with User] line.
    // Run unconditionally so pre-existing stat drift is backfilled too.
    ensureCoreMemory(characterId, characterName ?? characterId);
    syncStatsToCore(characterId);

    return Response.json({
      ok:       true,
      entities: writtenEntities,
      facts:    writtenFacts,
      stats:    writtenStats,
      rawModel: rawText.slice(0, 200) + (rawText.length > 200 ? "…" : ""),
    });
  } catch (err) {
    console.error("[drawer/extract]", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

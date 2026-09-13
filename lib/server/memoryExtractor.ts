// ─── Drawer 2 extraction ──────────────────────────────────────────────────────
// Read a stretch of conversation and write what it revealed into the knowledge
// graph: entities, facts, relationship deltas, commitments, shared language,
// the story clock. Server-side only — it writes through FableStore.
//
// Sits next to memoryRewriter.ts, its Drawer 1 twin: both take the same
// request envelope, call a local model, and return a result the route turns
// into a response. The whole pipeline used to live inside the route handler,
// which left extraction with two homes depending on which drawer you meant.

import { getStore } from "@/lib/db";
import type { FableStore } from "@/lib/db/store";
import { callLLM, parseLLMJson } from "@/lib/llm/callers";
import { embedTexts, vecToBuffer } from "@/lib/llm/embeddings";
import { syncStatsToCore, syncCommitmentsToCore } from "@/lib/server/coreMemory";
import { isEntityType, isWritableStatName } from "@/lib/db/models";
import type { StatName } from "@/lib/db/models";
import type { MemoryTaskRequest } from "@/lib/types";
import { buildExtractionPrompt } from "@/lib/server/extractionPrompt";
import type { ProviderType } from "@/lib/llm/callers";
import { contentWords, coverage, jaccard } from "@/lib/text/overlap";

// ─── Extraction result shape ──────────────────────────────────────────────────

// Every member is optional because the model decides what to emit and
// parseLLMJson casts whatever came back. The reads all guard with ?? [];
// declaring these required made that guarding look like dead defence.
interface RawExtraction {
  entities?:    Array<{ id: string; type: string; name: string; description?: string }>;
  facts?:       Array<{ subject: string; predicate: string; object: string; confidence?: number; importance?: number }>;
  stat_changes?:Array<{ observer: string; target: string; stat: StatName; delta: number }>;
  commitments?: Array<{ promisor: string; promisee?: string; description: string }>;
  resolved_commitments?: Array<{ match: string; status: string }>;
  shared_language?: Array<{ kind: string; text: string }>;
  story_time?: string | null;
}

// ─── Entity identity resolution ───────────────────────────────────────────────
// Models drift off the roster no matter how the prompt is worded, emitting
// "theron" beside an existing "char-theron". Both describe the same person, but
// facts land on the invented id and retrieveFactsForPrompt(characterId) then
// reads an empty graph. Resolve incoming ids onto existing entities by name
// before anything is written, so drift can't fragment the graph.

const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Clamp model-supplied numbers: an out-of-range confidence would trip the
// schema CHECK mid-pipeline and leave a half-written turn.
const clamp01 = (v: unknown, dflt: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : dflt;

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

  /**
   * Fold a model-minted id onto an existing entity of the same name, or
   * register it as new. Returns the canonical id when it was folded — a
   * non-null result means the caller must NOT create an entity.
   */
  aliasIfKnown(id: string, name: string): string | null {
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

// ─── Write stages ─────────────────────────────────────────────────────────────
// One function per thing the extractor writes. They ran inline in the route
// handler, which made POST a 366-line body where the boundary between "parse
// the model's output" and "write to the graph" was a comment.

/** The extractor writes entities before facts so facts can reference them. */
function writeEntities(
  store: FableStore, chatId: string, extracted: RawExtraction, resolver: EntityResolver
): string[] {
  // ── Write extracted entities ──────────────────────────────────────────
  // An entity whose name matches one already in the graph is not created;
  // its id is aliased instead, so the graph never gains a twin.

  const writtenEntities: string[] = [];
  for (const e of extracted.entities ?? []) {
    if (!e.id || !e.name) continue;
    if (resolver.aliasIfKnown(e.id, e.name)) continue; // folded onto an existing entity
    // The model invents types; anything unrecognised becomes a character
    // rather than tripping the schema CHECK mid-pipeline.
    const type = isEntityType(e.type) ? e.type : "character";
    store.ensureEntity(chatId, e.id, type, e.name, e.description ?? "");
    writtenEntities.push(e.id);
  }
  return writtenEntities;
}

function writeFacts(
  store: FableStore, chatId: string, extracted: RawExtraction,
  resolver: EntityResolver, witnessIds: string[]
): number[] {
  // ── Write extracted facts ─────────────────────────────────────────────
  // Dedup and supersession are store.assertFact's job — the invariant
  // belongs with the table, not with each caller. What is left here is what
  // only extraction knows: routing ids onto canonical entities, deciding
  // literal vs entity object, clamping the model's numbers, and the witness
  // stamp.

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

    const objectEntity = store.getEntity(chatId, f.object);

    const { factId, duplicate } = store.assertFact(chatId, {
      subjectId:     f.subject,
      predicate:     f.predicate,
      objectId:      objectEntity ? f.object : null,
      objectLiteral: objectEntity ? null : f.object,
      confidence:    clamp01(f.confidence, 0.85),
      importance:    clamp01(f.importance, 0.5),
      // Witness stamp: group facts belong to whoever was in the scene
      knownTo:       witnessIds,
    });
    if (!duplicate) writtenFacts.push(factId);
  }
  return writtenFacts;
}

function writeStatChanges(
  store: FableStore, chatId: string, extracted: RawExtraction, resolver: EntityResolver
): string[] {
  // ── Write stat changes ────────────────────────────────────────────────

  // Relationship stats only — mood lives in Drawer 1 (VAD), and letting the
  // model write a "mood" stat row produced a stray -11 in the Tilly soak.
  const writtenStats: string[] = [];

  for (const rawSc of extracted.stat_changes ?? []) {
    if (!rawSc.observer || !rawSc.target || !isWritableStatName(rawSc.stat)) continue;
    if (typeof rawSc.delta !== "number" || !Number.isFinite(rawSc.delta)) continue;
    // The prompt asks for ±3-20; a model emitting 10000 must not rail a
    // stat past every carefully tuned dynamic in one write.
    rawSc.delta = Math.max(-30, Math.min(30, rawSc.delta));

    const sc = {
      ...rawSc,
      observer: resolver.resolve(rawSc.observer),
      target:   resolver.resolve(rawSc.target),
    };

    store.ensureEntity(chatId, sc.observer, "character", sc.observer);
    store.ensureEntity(chatId, sc.target,   "character", sc.target);
    store.deltaStat(chatId, sc.observer, sc.target, sc.stat, sc.delta);
    writtenStats.push(`${sc.observer}->${sc.target}:${sc.stat}(${sc.delta > 0 ? "+" : ""}${sc.delta})`);
  }
  return writtenStats;
}

/** Returns the ids of older facts folded into a new one as restatements. */
async function embedNewFacts(
  store: FableStore, chatId: string, writtenFacts: number[]
): Promise<number[]> {
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
        store.setFactEmbedding(chatId, id, vecToBuffer(vec));
        // Semantic dedupe: a restatement of an existing fact ("trusts Kael
        // deeply" next to "has deep trust in Kael") passes the exact-key
        // check above but adds no information — it only steals a prompt
        // slot. The NEW fact survives and the old one is superseded by it:
        // if the "restatement" was actually a reversal that cleared the
        // similarity bar, newest-wins is the correct outcome, and the
        // timeline reads forward either way.
        const f = byId.get(id);
        if (f) {
          const dup = store.findSimilarLiveFact(chatId, f.subjectId, f.predicate, vec, newIds);
          if (dup !== null) {
            store.supersedeFact(chatId, dup.id, id);
            store.raiseFactImportance(chatId, id, dup.importance);
            foldedFacts.push(dup.id);
          }
        }
      });
    }
  }
  return foldedFacts;
}

/**
 * Two promises are the same promise when their distinctive words mostly
 * overlap. Exact-string matching let paraphrases pile up — soak #3 accumulated
 * ~200 active rows holding five variants of the same shirt promise.
 */
function isRestatement(incoming: string, existing: string): boolean {
  return jaccard(contentWords(incoming), contentWords(existing)) >= 0.5;
}

function writeCommitments(
  store: FableStore, chatId: string, extracted: RawExtraction, resolver: EntityResolver
): string[] {
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

    // Dedup among the promisor's active commitments
    const dup = store.listAllCommitments(chatId, "active")
      .some((c) => c.promisorId === promisor && isRestatement(rawC.description, c.description));
    if (dup) continue;

    store.insertCommitment(chatId, promisor, rawC.description.trim(), promisee);
    writtenCommitments.push(rawC.description.trim());
  }
  return writtenCommitments;
}

/** Close out commitments the scene fulfilled or broke. */
function resolveCommitments(
  store: FableStore, chatId: string, extracted: RawExtraction
): void {
  for (const res of extracted.resolved_commitments ?? []) {
    if (!res.match?.trim() || !["fulfilled", "broken"].includes(res.status)) continue;
    const words = contentWords(res.match);
    if (words.size === 0) continue;
    // Coverage, not Jaccard: the model quotes a fragment of a longer promise,
    // so what matters is how much of the fragment the commitment contains —
    // scoring symmetrically would penalise the commitment for being longer.
    const active = store.listAllCommitments(chatId, "active");
    let best: { id: number; score: number } | null = null;
    for (const c of active) {
      const score = coverage(words, contentWords(c.description));
      if (score >= 0.5 && (!best || score > best.score)) best = { id: c.id, score };
    }
    if (best) {
      store.updateCommitmentStatus(chatId, best.id, res.status as "fulfilled" | "broken");
    }
  }
}

function writeSharedLanguage(
  store: FableStore, chatId: string, extracted: RawExtraction
): string[] {
  // ── Shared language ───────────────────────────────────────────────────
  // Running gags / nicknames / rituals. upsert: a re-mention reinforces the
  // existing card instead of duplicating it.
  const writtenSharedLanguage: string[] = [];
  const validKinds = ["nickname", "joke", "ritual", "phrase"];
  for (const entry of extracted.shared_language ?? []) {
    if (!entry.text?.trim()) continue;
    const kind = validKinds.includes(entry.kind) ? entry.kind : "phrase";
    const { reinforced } = store.upsertSharedLanguageCard(chatId, kind, entry.text.trim());
    writtenSharedLanguage.push(`${kind}:${entry.text.trim().slice(0, 40)}${reinforced ? " (reinforced)" : ""}`);
  }
  return writtenSharedLanguage;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export type ExtractionResult =
  | { ok: false; error: string; rawModel: string }
  | {
      ok: true;
      entities: string[];
      facts: number[];
      folded: number;
      stats: string[];
      commitments: string[];
      sharedLanguage: string[];
      remapped: string[];
      rawModel: string;
    };

export async function extractMemory(
  input: MemoryTaskRequest & { providerType: ProviderType }
): Promise<ExtractionResult> {
  const {
    messages, chatId, characterId, characterName, personaName,
    providerType, providerBaseUrl, modelId, apiKey, participants,
  } = input;

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

  // Validated present-participant list (group chats). Facts extracted this
  // turn are witnessed by exactly these ids; empty = 1:1, facts are public.
  const present: Array<{ id: string; name: string }> = Array.isArray(participants)
    ? participants.filter(
        (p): p is { id: string; name: string } =>
          !!p && typeof p.id === "string" && typeof p.name === "string"
      )
    : [];
  for (const p of present) {
    store.ensureEntity(chatId, p.id, "character", p.name);
  }
  const witnessIds = present.map((p) => p.id);

  const knownEntities = store.listEntities(chatId).map((e) => ({
    id: e.id, name: e.name, type: e.type,
  }));
  const prompt = buildExtractionPrompt({
    messages,
    characterName: characterName ?? characterId,
    characterId,
    userLabel: personaName ?? "User",
    userId:    "player",
    knownEntities,
    participants: present,
  });

  // ── Call LLM ──────────────────────────────────────────────────────────

  let rawText: string;
  try {
    rawText = await callLLM({ providerType, providerBaseUrl, modelId, apiKey }, prompt);
  } catch (err) {
    // Reported as an upstream failure, not an extraction failure: nothing was
    // written, and the caller needs to know which of the two happened.
    return { ok: false as const, error: `the model could not be reached: ${String(err)}`, rawModel: "" };
  }

  // Parse failure must be distinguishable from "nothing to extract" — an
  // empty-object fallback here would make a model that can't emit JSON look
  // identical to a quiet conversation, and nothing would ever reach the DB.
  const extracted = parseLLMJson<RawExtraction | null>(rawText, null);
  if (!extracted) {
    console.warn("[drawer/extract] unparseable LLM output:", rawText.slice(0, 300));
    return {
      ok:       false as const,
      error:    "model returned unparseable JSON — nothing extracted",
      rawModel: rawText.slice(0, 200) + (rawText.length > 200 ? "…" : ""),
    };
  }

  // ── Resolve model-minted ids onto existing entities ───────────────────

  const resolver = new EntityResolver(knownEntities, [
    { id: characterId, name: characterName ?? characterId },
    { id: "player",    name: personaName },
  ]);

  const writtenEntities    = writeEntities(store, chatId, extracted, resolver);
  const writtenFacts       = writeFacts(store, chatId, extracted, resolver, witnessIds);
  const writtenStats       = writeStatChanges(store, chatId, extracted, resolver);
  const foldedFacts        = await embedNewFacts(store, chatId, writtenFacts);
  const writtenCommitments = writeCommitments(store, chatId, extracted, resolver);
  resolveCommitments(store, chatId, extracted);
  const writtenSharedLanguage        = writeSharedLanguage(store, chatId, extracted);

  // ── Story clock ───────────────────────────────────────────────────────
  // The in-fiction "now" — lets the prompt surface commitments whose moment
  // has arrived. Only overwrite when the model actually saw a time.
  store.ensureCoreMemory(chatId, characterId, characterName ?? characterId);
  if (typeof extracted.story_time === "string" && extracted.story_time.trim() &&
      extracted.story_time.trim().toLowerCase() !== "null") {
    store.patchCoreMemory(chatId, characterId, { story_time: extracted.story_time.trim().slice(0, 120) });
  }

  // ── Mirror Drawer-2 stats into the Core Memory Block (Drawer 1) ────────
  // Without this, relationship_with_user stays at its 50-neutral defaults
  // and buildSystemPrompt never emits the [Relationship with User] line.
  // Run unconditionally so pre-existing stat drift is backfilled too.
  syncStatsToCore(chatId, characterId);
  syncCommitmentsToCore(chatId, characterId, personaName ?? "the user");

  return {
    ok:          true,
    entities:    writtenEntities,
    facts:       writtenFacts,
    // Older facts superseded because a new fact restated them
    folded:      foldedFacts.length,
    stats:       writtenStats,
    commitments: writtenCommitments,
    sharedLanguage:        writtenSharedLanguage,
    // Which model-minted ids were folded onto existing entities. A large or
    // growing list means the prompt's identity anchoring is losing.
    remapped: resolver.remapped.map(([from, to]) => `${from}->${to}`),
    rawModel: rawText.slice(0, 200) + (rawText.length > 200 ? "…" : ""),
  };
}

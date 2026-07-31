// ─── FableStore (TypeScript) ──────────────────────────────────────────────────
// TypeScript port of fable_drawer2/db.py using better-sqlite3.
// All operations are synchronous (better-sqlite3 is sync-first).

import Database, { type Database as DB } from "better-sqlite3";
import fs from "fs";
import path from "path";
import { CREATE_TABLES_SQL } from "./schema";
import { isDurableFact, isIdentityCoreFact } from "./predicates";
import { bufferToVec, cosine } from "@/lib/llm/embeddings";
import type {
  DbEntity,
  DbFact,
  DbRelationshipStat,
  DbMemoryCard,
  DbCommitment,
  DbCoreMemory,
  CoreMemory,
  EntityType,
  StatName,
  CommitmentStatus,
  CharacterSummaryData,
} from "./models";
import { DEFAULT_DECAY_RATES, STAT_NAMES } from "./models";

function now(): number {
  return Math.floor(Date.now() / 1000);
}

// ─── Row → Model mappers ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToEntity(r: any): DbEntity {
  return {
    id:          r.id,
    type:        r.type as EntityType,
    name:        r.name,
    description: r.description ?? "",
    createdAt:   r.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToFact(r: any): DbFact {
  return {
    id:            r.id,
    subjectId:     r.subject_id,
    predicate:     r.predicate,
    objectId:      r.object_id ?? null,
    objectLiteral: r.object_literal ?? null,
    tValidStart:   r.t_valid_start,
    tValidEnd:     r.t_valid_end ?? null,
    tIngested:     r.t_ingested,
    confidence:    r.confidence,
    importance:    r.importance ?? 0.5,
    knownTo:       r.known_to ? (JSON.parse(r.known_to) as string[]) : [],
    supersededBy:  r.superseded_by ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToStat(r: any): DbRelationshipStat {
  return {
    id:          r.id,
    observerId:  r.observer_id,
    targetId:    r.target_id,
    statName:    r.stat_name as StatName,
    value:       r.value,
    decayRate:   r.decay_rate,
    lastUpdated: r.last_updated,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToMemoryCard(r: any): DbMemoryCard {
  return {
    id:         r.id,
    title:      r.title,
    content:    r.content,
    tags:       r.tags ? (JSON.parse(r.tags) as string[]) : [],
    entityIds:  r.entity_ids ? (JSON.parse(r.entity_ids) as string[]) : [],
    importance: r.importance ?? 0.5,
    createdAt:  r.created_at,
    updatedAt:  r.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToCommitment(r: any): DbCommitment {
  return {
    id:          r.id,
    promisorId:  r.promisor_id,
    promiseeId:  r.promisee_id ?? null,
    description: r.description,
    status:      r.status as CommitmentStatus,
    createdAt:   r.created_at,
    resolvedAt:  r.resolved_at ?? null,
  };
}

// ─── FableStore ───────────────────────────────────────────────────────────────

export class FableStore {
  private db: DB;

  constructor(dbPath: string) {
    // Ensure parent directory exists
    const dir = path.dirname(dbPath);
    if (dir && dir !== "." && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this._migrateIfNeeded();
    this._initSchema();
    this._ensureColumns();
  }

  // Additive column upgrades — safe on any schema version. CREATE TABLE IF NOT
  // EXISTS never alters existing tables, so new columns must be added here.
  private _ensureColumns(): void {
    const addCol = (table: string, col: string, ddl: string) => {
      const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (cols.length > 0 && !cols.some((c) => c.name === col)) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
      }
    };
    // Importance: how much a memory matters to the story — the retrieval sort
    // key. Distinct from confidence (how sure the extractor is): "her sister is
    // Elen" and "the bridge toll went up" can both be confidence 0.95 while
    // differing enormously in importance.
    addCol("facts",        "importance", "importance REAL NOT NULL DEFAULT 0.5");
    addCol("memory_cards", "importance", "importance REAL NOT NULL DEFAULT 0.5");
    // Rupture recovery: a countdown set when a stat takes a large negative hit.
    // While positive, positive deltas on that stat are dampened — the
    // validation soak showed trust re-crossing its pre-betrayal peak within 15
    // exchanges because nothing made the character hold the wound.
    addCol("relationship_stats", "rupture_recovery", "rupture_recovery INTEGER NOT NULL DEFAULT 0");
    // Embeddings for semantic retrieval (Phase C) — nullable, lexical fallback
    addCol("facts",        "embedding", "embedding BLOB");
    addCol("memory_cards", "embedding", "embedding BLOB");
  }

  // ── Migration: character-global memory → chat-scoped memory ───────────────
  // Schema v1 keyed memory by character only, so every chat with a character
  // shared one pool of facts and one core memory. v2 scopes everything by
  // chat_id: each chat is its own story. Legacy rows are assigned to the first
  // existing chat that belongs to the character owning the legacy core memory
  // (in practice: the demo chat they came from), else to 'legacy'.
  private _migrateIfNeeded(): void {
    const cols = this.db.prepare("PRAGMA table_info(entities)").all() as Array<{ name: string }>;
    if (cols.length === 0) return;                    // fresh DB — nothing to migrate
    if (cols.some((c) => c.name === "chat_id")) return; // already v2

    let target = "legacy";
    try {
      const cm = this.db.prepare("SELECT character_id FROM core_memory LIMIT 1").get() as
        { character_id: string } | undefined;
      if (cm) {
        const chats = this.db.prepare("SELECT id, data FROM app_chats ORDER BY seq").all() as
          Array<{ id: string; data: string }>;
        for (const c of chats) {
          try {
            if ((JSON.parse(c.data) as { characterId?: string }).characterId === cm.character_id) {
              target = c.id;
              break;
            }
          } catch { /* skip unparseable row */ }
        }
      }
    } catch { /* no core_memory table or app_chats — keep 'legacy' */ }

    console.log(`[FableStore] migrating memory schema v1 → v2 (chat-scoped); legacy rows → chat '${target}'`);

    this.db.pragma("foreign_keys = OFF");
    const migrate = this.db.transaction(() => {
      const OLD = ["entities", "facts", "relationship_stats", "memory_cards", "commitments", "core_memory"];
      for (const t of OLD) {
        this.db.exec(`ALTER TABLE ${t} RENAME TO ${t}_v1`);
      }
      this._initSchema(); // creates the v2 tables

      this.db.exec(`INSERT INTO entities (chat_id, id, type, name, description, created_at)
        SELECT '${target}', id, type, name, description, created_at FROM entities_v1`);
      // Fact ids preserved so superseded_by links stay valid
      this.db.exec(`INSERT INTO facts (id, chat_id, subject_id, predicate, object_id, object_literal,
          t_valid_start, t_valid_end, t_ingested, confidence, known_to, superseded_by)
        SELECT id, '${target}', subject_id, predicate, object_id, object_literal,
          t_valid_start, t_valid_end, t_ingested, confidence, known_to, superseded_by FROM facts_v1`);
      this.db.exec(`INSERT INTO relationship_stats (chat_id, observer_id, target_id, stat_name, value, decay_rate, last_updated)
        SELECT '${target}', observer_id, target_id, stat_name, value, decay_rate, last_updated FROM relationship_stats_v1`);
      this.db.exec(`INSERT INTO memory_cards (chat_id, title, content, tags, entity_ids, created_at, updated_at)
        SELECT '${target}', title, content, tags, entity_ids, created_at, updated_at FROM memory_cards_v1`);
      this.db.exec(`INSERT INTO commitments (chat_id, promisor_id, promisee_id, description, status, created_at, resolved_at)
        SELECT '${target}', promisor_id, promisee_id, description, status, created_at, resolved_at FROM commitments_v1`);
      this.db.exec(`INSERT INTO core_memory (chat_id, character_id, data, version, updated_at)
        SELECT '${target}', character_id, data, version, updated_at FROM core_memory_v1`);

      for (const t of OLD) {
        this.db.exec(`DROP TABLE ${t}_v1`);
      }
    });
    try {
      migrate();
    } finally {
      this.db.pragma("foreign_keys = ON");
    }
  }

  private _initSchema(): void {
    // Execute each statement separately (better-sqlite3 doesn't support multi-statement exec).
    // Strip comment lines before filtering so that SQL blocks preceded by -- comments
    // are not accidentally dropped.
    const statements = CREATE_TABLES_SQL
      .split(";")
      .map((chunk) =>
        chunk
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .trim()
      )
      .filter((s) => s.length > 0);
    for (const sql of statements) {
      try {
        this.db.exec(sql + ";");
      } catch (err) {
        // "already exists" is expected on re-init; anything else is a real
        // schema failure that must not be swallowed silently.
        const msg = err instanceof Error ? err.message : String(err);
        if (!/already exists/i.test(msg)) {
          console.error("[FableStore] schema statement failed:", msg, "\nSQL:", sql.slice(0, 120));
          throw err;
        }
      }
    }
  }

  close(): void {
    this.db.close();
  }

  // ── Entities ──────────────────────────────────────────────────────────────
  // All memory operations are scoped by chatId: each chat is its own story.

  insertEntity(chatId: string, entity: Omit<DbEntity, "createdAt"> & { createdAt?: number }): void {
    const createdAt = entity.createdAt ?? now();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO entities (chat_id, id, type, name, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(chatId, entity.id, entity.type, entity.name, entity.description ?? "", createdAt);
  }

  /** Upsert — safe to call even if entity already exists */
  ensureEntity(
    chatId: string,
    id: string,
    type: EntityType,
    name: string,
    description = ""
  ): DbEntity {
    const existing = this.getEntity(chatId, id);
    if (existing) return existing;
    const e: DbEntity = { id, type, name, description, createdAt: now() };
    this.insertEntity(chatId, e);
    return e;
  }

  getEntity(chatId: string, id: string): DbEntity | null {
    const row = this.db
      .prepare("SELECT * FROM entities WHERE chat_id = ? AND id = ?")
      .get(chatId, id);
    return row ? rowToEntity(row) : null;
  }

  listEntities(chatId: string, type?: EntityType): DbEntity[] {
    const rows = type
      ? this.db.prepare("SELECT * FROM entities WHERE chat_id = ? AND type = ? ORDER BY name").all(chatId, type)
      : this.db.prepare("SELECT * FROM entities WHERE chat_id = ? ORDER BY type, name").all(chatId);
    return rows.map(rowToEntity);
  }

  // ── Facts ─────────────────────────────────────────────────────────────────

  insertFact(chatId: string, fact: {
    subjectId:     string;
    predicate:     string;
    objectId?:     string | null;
    objectLiteral?:string | null;
    confidence?:   number;
    importance?:   number;
    knownTo?:      string[];
    tValidStart?:  number;
  }): number {
    const t = now();
    const stmt = this.db.prepare(
      `INSERT INTO facts
         (chat_id, subject_id, predicate, object_id, object_literal,
          t_valid_start, t_valid_end, t_ingested,
          confidence, importance, known_to, superseded_by)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL)`
    );
    const info = stmt.run(
      chatId,
      fact.subjectId,
      fact.predicate,
      fact.objectId ?? null,
      fact.objectLiteral ?? null,
      fact.tValidStart ?? t,
      t,
      fact.confidence ?? 1.0,
      Math.max(0, Math.min(1, fact.importance ?? 0.5)),
      JSON.stringify(fact.knownTo ?? []),
    );
    return info.lastInsertRowid as number;
  }

  /**
   * Query facts valid at a given time (defaults to now).
   * Uses temporal-only filter — superseded facts are already excluded because
   * supersede_fact() sets t_valid_end, which the temporal query handles.
   */
  queryFacts(chatId: string, subjectId: string, asOfTime?: number): DbFact[] {
    const t = asOfTime ?? now();
    const rows = this.db
      .prepare(
        `SELECT * FROM facts
         WHERE chat_id = ? AND subject_id = ?
           AND t_valid_start <= ?
           AND (t_valid_end IS NULL OR t_valid_end > ?)
         ORDER BY t_valid_start`
      )
      .all(chatId, subjectId, t, t);
    return rows.map(rowToFact);
  }

  /** Every currently-valid fact in the chat, regardless of subject */
  queryAllLiveFacts(chatId: string, asOfTime?: number): DbFact[] {
    const t = asOfTime ?? now();
    return this.db
      .prepare(
        `SELECT * FROM facts
         WHERE chat_id = ?
           AND t_valid_start <= ?
           AND (t_valid_end IS NULL OR t_valid_end > ?)
           AND superseded_by IS NULL
         ORDER BY t_valid_start`
      )
      .all(chatId, t, t)
      .map(rowToFact);
  }

  queryFactsIncludingSuperseded(chatId: string, subjectId: string): DbFact[] {
    const rows = this.db
      .prepare("SELECT * FROM facts WHERE chat_id = ? AND subject_id = ? ORDER BY t_valid_start")
      .all(chatId, subjectId);
    return rows.map(rowToFact);
  }

  setFactEmbedding(factId: number, embedding: Buffer): void {
    this.db.prepare("UPDATE facts SET embedding = ? WHERE id = ?").run(embedding, factId);
  }

  setCardEmbedding(cardId: number, embedding: Buffer): void {
    this.db.prepare("UPDATE memory_cards SET embedding = ? WHERE id = ?").run(embedding, cardId);
  }

  /** Raw embedding blob for a fact (null when never embedded) */
  private factEmbedding(factId: number): Float32Array | null {
    const row = this.db.prepare("SELECT embedding FROM facts WHERE id = ?").get(factId) as
      { embedding: Buffer | null } | undefined;
    return bufferToVec(row?.embedding ?? null);
  }

  /**
   * Among a subject's OLDER live facts (excluding the given ids), find one
   * semantically near-identical to `vec`. Used at write time to fold
   * restatements — "trusts Kael deeply" arriving next to "has deep trust in
   * Kael" — so redundant facts stop stealing prompt-window slots.
   */
  findSimilarLiveFact(
    chatId:     string,
    subjectId:  string,
    vec:        Float32Array,
    excludeIds: Set<number>,
    threshold = 0.92
  ): number | null {
    for (const f of this.queryFacts(chatId, subjectId)) {
      if (excludeIds.has(f.id)) continue;
      const other = this.factEmbedding(f.id);
      if (other && cosine(vec, other) >= threshold) return f.id;
    }
    return null;
  }

  supersedeFact(oldId: number, newId: number, atTime?: number): void {
    const t = atTime ?? now();
    this.db
      .prepare("UPDATE facts SET t_valid_end = ?, superseded_by = ? WHERE id = ?")
      .run(t, newId, oldId);
  }

  /** Facts where this entity appears as the *object* */
  queryFactsAboutAsObject(chatId: string, entityId: string, asOfTime?: number): DbFact[] {
    const t = asOfTime ?? now();
    const rows = this.db
      .prepare(
        `SELECT * FROM facts
         WHERE chat_id = ? AND object_id = ?
           AND t_valid_start <= ?
           AND (t_valid_end IS NULL OR t_valid_end > ?)
         ORDER BY t_valid_start`
      )
      .all(chatId, entityId, t, t);
    return rows.map(rowToFact);
  }

  findContradictions(chatId: string): Array<[DbFact, DbFact]> {
    const t = now();
    const rows = this.db
      .prepare(
        `SELECT * FROM facts
         WHERE chat_id = ?
           AND t_valid_start <= ?
           AND (t_valid_end IS NULL OR t_valid_end > ?)
         ORDER BY subject_id, predicate, t_valid_start`
      )
      .all(chatId, t, t)
      .map(rowToFact);

    const pairs: Array<[DbFact, DbFact]> = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i], b = rows[j];
        if (a.subjectId === b.subjectId && a.predicate === b.predicate) {
          const aObj = a.objectId ?? a.objectLiteral;
          const bObj = b.objectId ?? b.objectLiteral;
          if (aObj !== bObj) pairs.push([a, b]);
        }
      }
    }
    return pairs;
  }

  // ── Relationship Stats ────────────────────────────────────────────────────

  setStat(
    chatId:     string,
    observerId: string,
    targetId:   string,
    statName:   StatName,
    value:      number
  ): DbRelationshipStat {
    const decayRate = DEFAULT_DECAY_RATES[statName];
    const t = now();
    this.db
      .prepare(
        `INSERT INTO relationship_stats (chat_id, observer_id, target_id, stat_name, value, decay_rate, last_updated)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(chat_id, observer_id, target_id, stat_name)
         DO UPDATE SET value = excluded.value, last_updated = excluded.last_updated`
      )
      .run(chatId, observerId, targetId, statName, value, decayRate, t);

    return this.getStat(chatId, observerId, targetId, statName)!;
  }

  /**
   * Apply a relative change with emotional dynamics:
   *
   * - Headroom scaling — movement TOWARD an extreme is scaled by the room
   *   left (1 − |v|/100), so 0→60 is easy and 90→100 takes something
   *   extraordinary. Movement back toward neutral applies in full, so a
   *   betrayal at trust 100 still bites. Without this, stats ratchet to ±100
   *   within ~40 pleasant exchanges and lock the character's emotional range
   *   (measured in the 200-exchange soak — see docs/long-run-memory-report.md).
   * - Loss aversion — negative changes to affection/trust/connection are
   *   ×1.5: trust builds slowly and shatters quickly, which is also what
   *   makes repair arcs earn their length.
   */
  deltaStat(
    chatId:     string,
    observerId: string,
    targetId:   string,
    statName:   StatName,
    delta:      number
  ): DbRelationshipStat {
    const existing = this.getStat(chatId, observerId, targetId, statName);
    const current  = existing?.value ?? 0;
    const bondStat = statName === "affection" || statName === "trust" || statName === "connection";

    // Rupture refractory: after a large drop, the next several positive deltas
    // land at reduced strength — trust rebuilds slowly after being broken.
    const recovery = this.db
      .prepare("SELECT rupture_recovery FROM relationship_stats WHERE chat_id = ? AND observer_id = ? AND target_id = ? AND stat_name = ?")
      .get(chatId, observerId, targetId, statName) as { rupture_recovery: number } | undefined;
    const inRecovery = (recovery?.rupture_recovery ?? 0) > 0;

    let effective = delta;
    if (delta < 0 && bondStat) {
      effective *= 1.5; // loss aversion
    }
    if (delta > 0 && bondStat && inRecovery) {
      effective *= 0.35; // wounds heal slowly
    }
    const towardExtreme = Math.sign(effective) === Math.sign(current) || current === 0;
    if (towardExtreme) {
      effective *= 1 - Math.abs(current) / 100;
    }

    const updated = this.setStat(chatId, observerId, targetId, statName,
      Math.max(-100, Math.min(100, current + effective)));

    // Bookkeeping: a big hit opens a recovery window; positive movement
    // consumes it one step at a time.
    if (bondStat) {
      if (effective <= -12) {
        this.db.prepare(
          "UPDATE relationship_stats SET rupture_recovery = 6 WHERE chat_id = ? AND observer_id = ? AND target_id = ? AND stat_name = ?"
        ).run(chatId, observerId, targetId, statName);
      } else if (delta > 0 && inRecovery) {
        this.db.prepare(
          "UPDATE relationship_stats SET rupture_recovery = rupture_recovery - 1 WHERE chat_id = ? AND observer_id = ? AND target_id = ? AND stat_name = ? AND rupture_recovery > 0"
        ).run(chatId, observerId, targetId, statName);
      }
    }

    return updated;
  }

  /** True while any bond stat of the pair is inside its post-rupture window */
  isRecentlyRuptured(chatId: string, observerId: string, targetId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT MAX(rupture_recovery) AS r FROM relationship_stats
         WHERE chat_id = ? AND observer_id = ? AND target_id = ?
           AND stat_name IN ('trust','affection','connection')`
      )
      .get(chatId, observerId, targetId) as { r: number | null } | undefined;
    return (row?.r ?? 0) > 0;
  }

  getStat(
    chatId:     string,
    observerId: string,
    targetId:   string,
    statName:   StatName
  ): DbRelationshipStat | null {
    const row = this.db
      .prepare(
        "SELECT * FROM relationship_stats WHERE chat_id = ? AND observer_id = ? AND target_id = ? AND stat_name = ?"
      )
      .get(chatId, observerId, targetId, statName);
    return row ? rowToStat(row) : null;
  }

  queryStats(
    chatId:     string,
    observerId: string,
    targetId:   string
  ): Partial<Record<StatName, DbRelationshipStat>> {
    const rows = this.db
      .prepare(
        "SELECT * FROM relationship_stats WHERE chat_id = ? AND observer_id = ? AND target_id = ?"
      )
      .all(chatId, observerId, targetId);
    const result: Partial<Record<StatName, DbRelationshipStat>> = {};
    for (const row of rows) {
      const s = rowToStat(row);
      result[s.statName] = s;
    }
    return result;
  }

  /** Return all unique (observer, target) pairs that have any stats in a chat */
  allStatPairs(chatId: string): Array<{ observerId: string; targetId: string }> {
    const rows = this.db
      .prepare(
        "SELECT DISTINCT observer_id, target_id FROM relationship_stats WHERE chat_id = ?"
      )
      .all(chatId) as Array<{ observer_id: string; target_id: string }>;
    return rows.map((r) => ({ observerId: r.observer_id, targetId: r.target_id }));
  }

  /**
   * Apply Ebbinghaus decay to all stats using each row's own last_updated
   * timestamp, so recently-updated stats decay less than stale ones.
   *
   * new_value = old_value × (1 − decay_rate)^(rowDays / 7)
   */
  applyDecay(): Array<{
    observerId: string;
    targetId:   string;
    statName:   string;
    oldValue:   number;
    newValue:   number;
  }> {
    const t = now();
    const rows = this.db
      .prepare("SELECT * FROM relationship_stats")
      .all()
      .map(rowToStat);

    const changes: Array<{
      observerId: string; targetId: string; statName: string;
      oldValue: number; newValue: number;
    }> = [];

    const update = this.db.prepare(
      "UPDATE relationship_stats SET value = ?, last_updated = ? WHERE id = ?"
    );

    for (const stat of rows) {
      // Compute actual elapsed days for this specific row
      const rowDays = (t - stat.lastUpdated) / 86400; // lastUpdated is Unix seconds
      if (rowDays <= 0) continue; // updated this second — skip
      const newValue =
        stat.value * Math.pow(1.0 - stat.decayRate, rowDays / 7.0);
      update.run(newValue, t, stat.id);
      changes.push({
        observerId: stat.observerId,
        targetId:   stat.targetId,
        statName:   stat.statName,
        oldValue:   stat.value,
        newValue,
      });
    }
    return changes;
  }

  // ── Memory Cards ──────────────────────────────────────────────────────────

  insertMemoryCard(chatId: string, card: Omit<DbMemoryCard, "id" | "createdAt" | "updatedAt">): number {
    const t = now();
    const info = this.db
      .prepare(
        `INSERT INTO memory_cards (chat_id, title, content, tags, entity_ids, importance, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        chatId,
        card.title,
        card.content,
        JSON.stringify(card.tags ?? []),
        JSON.stringify(card.entityIds ?? []),
        Math.max(0, Math.min(1, card.importance ?? 0.5)),
        t, t,
      );
    return info.lastInsertRowid as number;
  }

  listMemoryCards(chatId: string, entityId?: string): DbMemoryCard[] {
    const rows = this.db
      .prepare("SELECT * FROM memory_cards WHERE chat_id = ? ORDER BY created_at DESC")
      .all(chatId)
      .map(rowToMemoryCard);
    if (!entityId) return rows;
    return rows.filter((c) => c.entityIds.includes(entityId));
  }

  /**
   * Episodic memories to inject into the prompt: scene cards and reflections,
   * ranked by importance with a recency tiebreak, optionally boosted by
   * relevance to the current conversation.
   */
  retrieveEpisodesForPrompt(
    chatId: string,
    limit = 3,
    context = "",
    queryEmbedding: Float32Array | null = null
  ): DbMemoryCard[] {
    const cards = this.listMemoryCards(chatId);
    if (cards.length === 0) return [];
    const contextWords = new Set(
      context.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3)
    );
    const cardVec = (id: number): Float32Array | null => {
      const row = this.db.prepare("SELECT embedding FROM memory_cards WHERE id = ?").get(id) as
        { embedding: Buffer | null } | undefined;
      return bufferToVec(row?.embedding ?? null);
    };
    const relevance = (c: DbMemoryCard): number => {
      if (queryEmbedding) {
        const v = cardVec(c.id);
        if (v) return Math.max(0, (cosine(queryEmbedding, v) - 0.3) / 0.6);
      }
      if (contextWords.size === 0) return 0;
      const words = `${c.title} ${c.content}`.toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3);
      if (words.length === 0) return 0;
      return words.filter((w) => contextWords.has(w)).length / words.length;
    };
    return [...cards]
      .sort((a, b) =>
        (b.importance + relevance(b)) - (a.importance + relevance(a)) ||
        b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  // ── Commitments ───────────────────────────────────────────────────────────

  insertCommitment(
    chatId:      string,
    promisorId:  string,
    description: string,
    promiseeId?: string
  ): number {
    const t = now();
    const info = this.db
      .prepare(
        `INSERT INTO commitments (chat_id, promisor_id, promisee_id, description, status, created_at, resolved_at)
         VALUES (?, ?, ?, ?, 'active', ?, NULL)`
      )
      .run(chatId, promisorId, promiseeId ?? null, description, t);
    return info.lastInsertRowid as number;
  }

  listCommitments(chatId: string, entityId: string, status?: CommitmentStatus): DbCommitment[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM commitments WHERE chat_id = ? AND promisor_id = ? ORDER BY created_at DESC"
      )
      .all(chatId, entityId)
      .map(rowToCommitment);
    return status ? rows.filter((c) => c.status === status) : rows;
  }

  /** Every commitment in the chat, either direction, newest first */
  allCommitments(chatId: string, status?: CommitmentStatus): DbCommitment[] {
    const rows = this.db
      .prepare("SELECT * FROM commitments WHERE chat_id = ? ORDER BY created_at DESC")
      .all(chatId)
      .map(rowToCommitment);
    return status ? rows.filter((c) => c.status === status) : rows;
  }

  updateCommitmentStatus(chatId: string, id: number, status: CommitmentStatus): void {
    this.db
      .prepare("UPDATE commitments SET status = ?, resolved_at = ? WHERE chat_id = ? AND id = ?")
      .run(status, status === "active" ? null : now(), chatId, id);
  }

  // ── Character Summary ─────────────────────────────────────────────────────

  characterSummary(chatId: string, entityId: string): CharacterSummaryData {
    const entity = this.getEntity(chatId, entityId);
    const facts  = this.queryFacts(chatId, entityId);

    // Collect all unique targets this entity has stats with
    const statRows = this.db
      .prepare(
        "SELECT * FROM relationship_stats WHERE chat_id = ? AND observer_id = ? ORDER BY target_id, stat_name"
      )
      .all(chatId, entityId)
      .map(rowToStat);

    const targetMap = new Map<
      string,
      { stats: Array<{ name: StatName; value: number; decayRate: number }> }
    >();
    for (const s of statRows) {
      if (!targetMap.has(s.targetId)) targetMap.set(s.targetId, { stats: [] });
      targetMap.get(s.targetId)!.stats.push({
        name:      s.statName,
        value:     s.value,
        decayRate: s.decayRate,
      });
    }

    const relationships = Array.from(targetMap.entries()).map(([targetId, data]) => {
      const targetEntity = this.getEntity(chatId, targetId);
      return {
        targetId,
        targetName: targetEntity?.name ?? targetId,
        stats:      data.stats,
      };
    });

    const commitments = this.listCommitments(chatId, entityId, "active");

    return {
      entity,
      relationships,
      facts: facts.map((f) => {
        const objectEntity = f.objectId ? this.getEntity(chatId, f.objectId) : null;
        const objectDisplay = objectEntity
          ? objectEntity.name + (f.objectLiteral ? ` / "${f.objectLiteral}"` : "")
          : f.objectLiteral
          ? `"${f.objectLiteral}"`
          : f.objectId ?? "";
        return {
          id:            f.id,
          predicate:     f.predicate,
          objectDisplay,
          confidence:    f.confidence,
          tValidStart:   f.tValidStart,
        };
      }),
      commitments,
    };
  }

  // ── Entity merge (inspector action) ──────────────────────────────────────

  /**
   * Merge `fromId` into `toId`: repoints all facts, relationship_stats, and
   * commitments, then deletes the now-orphaned entity. Runs in a transaction.
   * Any stat rows that would violate the UNIQUE constraint after the repoint
   * are dropped (toId's existing value wins).
   */
  mergeEntity(chatId: string, fromId: string, toId: string): void {
    const doMerge = this.db.transaction(() => {
      // ── Facts: repoint subject and object references ──────────────────────
      this.db.prepare("UPDATE facts SET subject_id = ? WHERE chat_id = ? AND subject_id = ?").run(toId, chatId, fromId);
      this.db.prepare("UPDATE facts SET object_id  = ? WHERE chat_id = ? AND object_id  = ?").run(toId, chatId, fromId);

      // ── Relationship stats (observer side) ────────────────────────────────
      // Delete fromId rows that would collide with an existing toId row
      const obsConflicts = this.db.prepare(`
        SELECT rs1.id FROM relationship_stats rs1
        WHERE rs1.chat_id = ? AND rs1.observer_id = ?
          AND EXISTS (
            SELECT 1 FROM relationship_stats rs2
            WHERE rs2.chat_id = rs1.chat_id AND rs2.observer_id = ? AND rs2.target_id = rs1.target_id AND rs2.stat_name = rs1.stat_name
          )
      `).all(chatId, fromId, toId) as { id: number }[];
      for (const row of obsConflicts) {
        this.db.prepare("DELETE FROM relationship_stats WHERE id = ?").run(row.id);
      }
      this.db.prepare("UPDATE relationship_stats SET observer_id = ? WHERE chat_id = ? AND observer_id = ?").run(toId, chatId, fromId);

      // ── Relationship stats (target side) ──────────────────────────────────
      const tgtConflicts = this.db.prepare(`
        SELECT rs1.id FROM relationship_stats rs1
        WHERE rs1.chat_id = ? AND rs1.target_id = ?
          AND EXISTS (
            SELECT 1 FROM relationship_stats rs2
            WHERE rs2.chat_id = rs1.chat_id AND rs2.target_id = ? AND rs2.observer_id = rs1.observer_id AND rs2.stat_name = rs1.stat_name
          )
      `).all(chatId, fromId, toId) as { id: number }[];
      for (const row of tgtConflicts) {
        this.db.prepare("DELETE FROM relationship_stats WHERE id = ?").run(row.id);
      }
      this.db.prepare("UPDATE relationship_stats SET target_id = ? WHERE chat_id = ? AND target_id = ?").run(toId, chatId, fromId);

      // ── Commitments ───────────────────────────────────────────────────────
      this.db.prepare("UPDATE commitments SET promisor_id = ? WHERE chat_id = ? AND promisor_id = ?").run(toId, chatId, fromId);
      this.db.prepare("UPDATE commitments SET promisee_id = ? WHERE chat_id = ? AND promisee_id = ?").run(toId, chatId, fromId);

      // ── Remove the now-orphaned entity ────────────────────────────────────
      this.db.prepare("DELETE FROM entities WHERE chat_id = ? AND id = ?").run(chatId, fromId);
    });
    doMerge();
  }

  // ── Core Memory (Drawer 1) ────────────────────────────────────────────────

  getCoreMemory(chatId: string, characterId: string): DbCoreMemory | null {
    const row = this.db
      .prepare("SELECT * FROM core_memory WHERE chat_id = ? AND character_id = ?")
      .get(chatId, characterId) as { character_id: string; data: string; version: number; updated_at: number } | undefined;
    if (!row) return null;
    return {
      characterId: row.character_id,
      data:        JSON.parse(row.data) as CoreMemory,
      version:     row.version,
      updatedAt:   row.updated_at,
    };
  }

  setCoreMemory(chatId: string, cm: CoreMemory): void {
    const t = now();
    this.db
      .prepare(
        `INSERT INTO core_memory (chat_id, character_id, data, version, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(chat_id, character_id)
         DO UPDATE SET data = excluded.data, version = excluded.version, updated_at = excluded.updated_at`
      )
      .run(chatId, cm.characterId, JSON.stringify({ ...cm, updatedAt: new Date(t * 1000).toISOString() }), cm.version ?? 1, t);
  }

  /** Partial update — merges top-level keys only (not nested objects) */
  patchCoreMemory(chatId: string, characterId: string, patch: Partial<CoreMemory>): DbCoreMemory | null {
    const existing = this.getCoreMemory(chatId, characterId);
    if (!existing) return null;
    const merged: CoreMemory = { ...existing.data, ...patch, characterId };
    merged.version = (existing.version ?? 0) + 1;
    this.setCoreMemory(chatId, merged);
    return this.getCoreMemory(chatId, characterId);
  }

  /** Returns existing core memory or creates a default one */
  ensureCoreMemory(chatId: string, characterId: string, characterName: string): DbCoreMemory {
    const existing = this.getCoreMemory(chatId, characterId);
    if (existing) return existing;

    const defaults: CoreMemory = {
      characterId,
      version:   1,
      updatedAt: new Date().toISOString(),
      persona:   `${characterName} is a character in this story. Their personality and backstory will emerge through conversation.`,
      mood: { valence: 0.1, arousal: 0.3, dominance: 0.5 },
      relationship_with_user: {
        affection: 50, trust: 50, desire: 50, connection: 50, mood: 50,
      },
      active_commitments:      [],
      recent_emotional_events: [],
      internal_thoughts:       [],
      narrative_summary:       "The story is just beginning.",
    };
    this.setCoreMemory(chatId, defaults);
    return this.getCoreMemory(chatId, characterId)!;
  }

  // ── App State (characters / chats / messages persistence) ─────────────────
  // Durable mirror of the client store. Objects are stored as JSON blobs;
  // `seq` preserves array order. Full-replace semantics: the client sends its
  // complete state and the transaction rewrites the mirror atomically.

  getAppState(): { characters: unknown[]; chats: unknown[]; personas: unknown[]; lorebooks: unknown[] } {
    const characters = (this.db
      .prepare("SELECT data FROM app_characters ORDER BY seq")
      .all() as Array<{ data: string }>).map((r) => JSON.parse(r.data));

    const personas = (this.db
      .prepare("SELECT data FROM app_personas ORDER BY seq")
      .all() as Array<{ data: string }>).map((r) => JSON.parse(r.data));

    const lorebooks = (this.db
      .prepare("SELECT data FROM app_lorebooks ORDER BY seq")
      .all() as Array<{ data: string }>).map((r) => JSON.parse(r.data));

    const chatRows = this.db
      .prepare("SELECT id, data FROM app_chats ORDER BY seq")
      .all() as Array<{ id: string; data: string }>;
    const msgStmt = this.db.prepare(
      "SELECT data FROM app_messages WHERE chat_id = ? ORDER BY seq"
    );

    const chats = chatRows.map((row) => ({
      ...(JSON.parse(row.data) as Record<string, unknown>),
      messages: (msgStmt.all(row.id) as Array<{ data: string }>).map((m) => JSON.parse(m.data)),
    }));

    return { characters, chats, personas, lorebooks };
  }

  replaceAppState(
    characters: Array<{ id: string }>,
    chats:      Array<{ id: string; messages?: Array<{ id: string }> }>,
    personas:   Array<{ id: string }> = [],
    lorebooks:  Array<{ id: string }> = []
  ): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM app_characters").run();
      this.db.prepare("DELETE FROM app_chats").run();
      this.db.prepare("DELETE FROM app_messages").run();
      this.db.prepare("DELETE FROM app_personas").run();
      this.db.prepare("DELETE FROM app_lorebooks").run();

      const insChar = this.db.prepare(
        "INSERT OR REPLACE INTO app_characters (id, seq, data) VALUES (?, ?, ?)"
      );
      characters.forEach((c, i) => insChar.run(c.id, i, JSON.stringify(c)));

      const insPersona = this.db.prepare(
        "INSERT OR REPLACE INTO app_personas (id, seq, data) VALUES (?, ?, ?)"
      );
      personas.forEach((p, i) => insPersona.run(p.id, i, JSON.stringify(p)));

      const insLorebook = this.db.prepare(
        "INSERT OR REPLACE INTO app_lorebooks (id, seq, data) VALUES (?, ?, ?)"
      );
      lorebooks.forEach((l, i) => insLorebook.run(l.id, i, JSON.stringify(l)));

      const insChat = this.db.prepare(
        "INSERT OR REPLACE INTO app_chats (id, seq, data) VALUES (?, ?, ?)"
      );
      const insMsg = this.db.prepare(
        "INSERT OR REPLACE INTO app_messages (id, chat_id, seq, data) VALUES (?, ?, ?, ?)"
      );
      chats.forEach((chat, i) => {
        const { messages = [], ...meta } = chat;
        insChat.run(chat.id, i, JSON.stringify(meta));
        messages.forEach((m, j) => insMsg.run(m.id, chat.id, j, JSON.stringify(m)));
      });
    });
    tx();
  }

  // ── Export ────────────────────────────────────────────────────────────────

  exportJson(chatId: string): {
    entities:    DbEntity[];
    facts:       DbFact[];
    stats:       DbRelationshipStat[];
    memoryCards: DbMemoryCard[];
    commitments: DbCommitment[];
  } {
    return {
      entities:    this.listEntities(chatId),
      facts:       this.db.prepare("SELECT * FROM facts WHERE chat_id = ? ORDER BY id").all(chatId).map(rowToFact),
      stats:       this.db.prepare("SELECT * FROM relationship_stats WHERE chat_id = ? ORDER BY id").all(chatId).map(rowToStat),
      memoryCards: this.listMemoryCards(chatId),
      commitments: this.db.prepare("SELECT * FROM commitments WHERE chat_id = ? ORDER BY id").all(chatId).map(rowToCommitment),
    };
  }

  // ── Memory lifecycle ──────────────────────────────────────────────────────

  /** Remove every memory row belonging to a chat */
  purgeChatMemory(chatId: string): void {
    const tx = this.db.transaction(() => {
      for (const t of ["facts", "relationship_stats", "commitments", "memory_cards", "core_memory", "entities"]) {
        this.db.prepare(`DELETE FROM ${t} WHERE chat_id = ?`).run(chatId);
      }
    });
    tx();
  }

  /**
   * Purge memory for chats that no longer exist in app_chats — deleting a chat
   * in the UI otherwise leaves its drawer rows orphaned forever. 'legacy'
   * (the pre-migration scope) is exempt so migrated data is never silently
   * destroyed.
   */
  purgeOrphanedChatMemory(): string[] {
    const known = new Set(
      (this.db.prepare("SELECT id FROM app_chats").all() as Array<{ id: string }>).map((r) => r.id)
    );
    const referenced = new Set<string>();
    for (const t of ["facts", "relationship_stats", "commitments", "memory_cards", "core_memory", "entities"]) {
      for (const r of this.db.prepare(`SELECT DISTINCT chat_id FROM ${t}`).all() as Array<{ chat_id: string }>) {
        referenced.add(r.chat_id);
      }
    }
    const orphans = [...referenced].filter((c) => !known.has(c) && c !== "legacy");
    for (const c of orphans) this.purgeChatMemory(c);
    return orphans;
  }

  // ── Memory transfer ───────────────────────────────────────────────────────

  /**
   * Chats that hold memories involving a character — candidates for
   * "continue with memories" when starting a new chat with them.
   */
  listMemorySources(characterId: string): Array<{
    chatId: string; chatName: string | null; facts: number; updatedAt: number;
  }> {
    const rows = this.db.prepare(`
      SELECT cm.chat_id AS chat_id,
             cm.updated_at AS updated_at,
             (SELECT COUNT(*) FROM facts f
               WHERE f.chat_id = cm.chat_id AND f.superseded_by IS NULL) AS facts
      FROM core_memory cm
      WHERE cm.character_id = ?
      ORDER BY cm.updated_at DESC
    `).all(characterId) as Array<{ chat_id: string; updated_at: number; facts: number }>;

    const nameOf = this.db.prepare("SELECT data FROM app_chats WHERE id = ?");
    return rows.map((r) => {
      let chatName: string | null = null;
      const chat = nameOf.get(r.chat_id) as { data: string } | undefined;
      if (chat) {
        try { chatName = (JSON.parse(chat.data) as { name?: string }).name ?? null; } catch { /* ignore */ }
      }
      return { chatId: r.chat_id, chatName, facts: r.facts, updatedAt: r.updated_at };
    });
  }

  /**
   * Copy one chat's entire memory into another chat. Used for the explicit
   * "continue with memories" option when starting a new chat — memory NEVER
   * carries over implicitly. Existing rows in the target chat are preserved;
   * colliding entities/stats keep the target's version.
   * Fact supersession links are remapped onto the copied ids.
   */
  transferMemory(fromChatId: string, toChatId: string): { entities: number; facts: number; stats: number } {
    let entities = 0, facts = 0, stats = 0;
    const tx = this.db.transaction(() => {
      // Entities — keep target's on collision
      for (const e of this.listEntities(fromChatId)) {
        if (!this.getEntity(toChatId, e.id)) {
          this.insertEntity(toChatId, e);
          entities++;
        }
      }

      // Facts — copy all (incl. superseded, preserving history), remap ids
      const srcFacts = this.db
        .prepare("SELECT * FROM facts WHERE chat_id = ? ORDER BY id")
        .all(fromChatId)
        .map(rowToFact);
      const idMap = new Map<number, number>();
      const ins = this.db.prepare(
        `INSERT INTO facts (chat_id, subject_id, predicate, object_id, object_literal,
           t_valid_start, t_valid_end, t_ingested, confidence, known_to, superseded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      );
      for (const f of srcFacts) {
        const info = ins.run(
          toChatId, f.subjectId, f.predicate, f.objectId, f.objectLiteral,
          f.tValidStart, f.tValidEnd, f.tIngested, f.confidence, JSON.stringify(f.knownTo)
        );
        idMap.set(f.id, info.lastInsertRowid as number);
        facts++;
      }
      const setSup = this.db.prepare("UPDATE facts SET superseded_by = ? WHERE id = ?");
      for (const f of srcFacts) {
        if (f.supersededBy !== null && idMap.has(f.supersededBy)) {
          setSup.run(idMap.get(f.supersededBy)!, idMap.get(f.id)!);
        }
      }

      // Stats — keep target's on collision
      const srcStats = this.db
        .prepare("SELECT * FROM relationship_stats WHERE chat_id = ?")
        .all(fromChatId)
        .map(rowToStat);
      const insStat = this.db.prepare(
        `INSERT OR IGNORE INTO relationship_stats
           (chat_id, observer_id, target_id, stat_name, value, decay_rate, last_updated)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const s of srcStats) {
        const r = insStat.run(toChatId, s.observerId, s.targetId, s.statName, s.value, s.decayRate, s.lastUpdated);
        if (r.changes > 0) stats++;
      }

      // Commitments and memory cards — straight copies
      const srcCommit = this.db.prepare("SELECT * FROM commitments WHERE chat_id = ?").all(fromChatId).map(rowToCommitment);
      const insCommit = this.db.prepare(
        `INSERT INTO commitments (chat_id, promisor_id, promisee_id, description, status, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const c of srcCommit) {
        insCommit.run(toChatId, c.promisorId, c.promiseeId, c.description, c.status, c.createdAt, c.resolvedAt);
      }
      const srcCards = this.db.prepare("SELECT * FROM memory_cards WHERE chat_id = ?").all(fromChatId).map(rowToMemoryCard);
      const insCard = this.db.prepare(
        `INSERT INTO memory_cards (chat_id, title, content, tags, entity_ids, importance, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const c of srcCards) {
        insCard.run(toChatId, c.title, c.content, JSON.stringify(c.tags), JSON.stringify(c.entityIds), c.importance, c.createdAt, c.updatedAt);
      }

      // Core memory — only if the target has none yet
      const rows = this.db
        .prepare("SELECT * FROM core_memory WHERE chat_id = ?")
        .all(fromChatId) as Array<{ character_id: string; data: string; version: number; updated_at: number }>;
      for (const row of rows) {
        const exists = this.db
          .prepare("SELECT 1 FROM core_memory WHERE chat_id = ? AND character_id = ?")
          .get(toChatId, row.character_id);
        if (!exists) {
          this.db
            .prepare("INSERT INTO core_memory (chat_id, character_id, data, version, updated_at) VALUES (?, ?, ?, ?, ?)")
            .run(toChatId, row.character_id, row.data, row.version, row.updated_at);
        }
      }
    });
    tx();
    return { entities, facts, stats };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Resolve a fact's object to a display string */
  factObjectDisplay(chatId: string, fact: DbFact): string {
    if (fact.objectId) {
      const e = this.getEntity(chatId, fact.objectId);
      if (e) return e.name + (fact.objectLiteral ? ` / "${fact.objectLiteral}"` : "");
      return fact.objectId;
    }
    return fact.objectLiteral ? `"${fact.objectLiteral}"` : "";
  }

  /**
   * Retrieve the currently-valid facts to inject into the system prompt.
   *
   * Two failure modes shaped this, both caught by tests/memory-eval:
   *
   * 1. It used to consider ONLY facts whose subject or object was the character.
   *    Everything the player says about themselves is stored under the `player`
   *    entity, so none of it was ever retrievable — the character could not
   *    remember your sister, your fear, or what you promised. For roleplay that
   *    is the wrong half of the graph. Facts about the player are now a
   *    first-class group with their own guaranteed share of the window.
   *
   * 2. Ranking by confidence-then-recency alone does not survive a long story.
   *    Every exchange adds facts, so anything learned early is pushed out within
   *    a handful of turns. Durable facts (identity, kinship, fears, promises,
   *    location) are therefore ranked ahead of incidental ones inside each group.
   *
   * Facts about neither participant — world knowledge picked up along the way —
   * compete for the remaining slots on relevance to the current conversation.
   *
   * `context` is recent conversation text; without it relevance is 0 everywhere
   * and ordering falls back to durable-then-confidence-then-recency.
   */
  retrieveFactsForPrompt(
    chatId: string,
    characterId: string,
    limit = 20,
    context = "",
    playerId = "player",
    queryEmbedding: Float32Array | null = null
  ): string[] {
    const all = this.queryAllLiveFacts(chatId);

    // Relevance: cosine similarity against the current exchange when both
    // sides have embeddings (semantic — "the crossing" matches "afraid of deep
    // water"), keyword overlap otherwise (lexical fallback).
    const contextWords = new Set(
      context.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3)
    );
    const relevanceOf = (f: DbFact): number => {
      if (queryEmbedding) {
        const v = this.factEmbedding(f.id);
        // Rescale cosine (~0.3..0.9 in practice) onto roughly the same 0..1
        // band lexical overlap produces, so mixed corpora rank sanely
        if (v) return Math.max(0, (cosine(queryEmbedding, v) - 0.3) / 0.6);
      }
      if (contextWords.size === 0) return 0;
      const text = `${f.predicate} ${f.objectId ?? ""} ${f.objectLiteral ?? ""}`.toLowerCase();
      const words = text.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3);
      if (words.length === 0) return 0;
      return words.filter((w) => contextWords.has(w)).length / words.length;
    };

    // Importance first (with the durable-predicate heuristic as a floor, so a
    // model that under-scores kinship/fear/promise facts can't age them out),
    // then relevance to the current exchange, then confidence, then recency.
    const importanceOf = (f: DbFact): number =>
      Math.max(f.importance, isDurableFact(f.predicate) ? 0.75 : 0);
    const rank = (a: DbFact, b: DbFact) =>
      (importanceOf(b) - importanceOf(a)) ||
      (relevanceOf(b) - relevanceOf(a)) ||
      (b.confidence - a.confidence) ||
      (b.tValidStart - a.tValidStart);

    const involves = (f: DbFact, id: string) => f.subjectId === id || f.objectId === id;

    // ── Pinned identity-core facts ────────────────────────────────────────
    // Family, fears, obligations, self-definition about either participant
    // bypass relevance ranking entirely. At 120 live facts vs a 20-slot
    // window, "sister Lila" fell out of the ranked pool late in the Tilly
    // soak and the model confabulated the opposite ("you're an only child")
    // rather than saying it didn't know. The cost of a miss here is
    // confident fiction, so these facts don't compete — they're always in.
    const PIN_CAP = Math.max(2, Math.floor(limit * 0.4));
    const pinned = all
      .filter((f) => (involves(f, characterId) || involves(f, playerId)) && isIdentityCoreFact(f.predicate))
      .sort(rank)
      .slice(0, PIN_CAP);
    const isPinned = new Set(pinned.map((f) => f.id));

    const aboutCharacter = all.filter((f) => !isPinned.has(f.id) && involves(f, characterId)).sort(rank);
    const aboutPlayer    = all.filter((f) => !isPinned.has(f.id) && !involves(f, characterId) && involves(f, playerId)).sort(rank);
    const world          = all.filter((f) => !isPinned.has(f.id) && !involves(f, characterId) && !involves(f, playerId)).sort(rank);

    // Each participant gets a guaranteed share of the remaining room so
    // neither can be crowded out. Take quotas first, then backfill any unused
    // room in group order, so a sparse group never wastes slots.
    const room = Math.max(0, limit - pinned.length);
    const quota = Math.max(1, Math.floor(room * 0.4));
    const groups = [aboutCharacter, aboutPlayer, world];
    const topFacts: DbFact[] = [
      ...pinned,
      ...aboutCharacter.slice(0, quota),
      ...aboutPlayer.slice(0, quota),
    ];
    for (const group of groups) {
      for (const f of group) {
        if (topFacts.length >= limit) break;
        if (!topFacts.includes(f)) topFacts.push(f);
      }
    }
    topFacts.length = Math.min(topFacts.length, limit);

    // Batch-fetch all referenced entities in one query (avoids N+1 per fact)
    const entityIds = new Set<string>();
    for (const f of topFacts) {
      entityIds.add(f.subjectId);
      if (f.objectId) entityIds.add(f.objectId);
    }
    const entityMap = new Map<string, DbEntity>();
    if (entityIds.size > 0) {
      const ids          = Array.from(entityIds);
      const placeholders = ids.map(() => "?").join(",");
      const fetched = this.db
        .prepare(`SELECT * FROM entities WHERE chat_id = ? AND id IN (${placeholders})`)
        .all(chatId, ...ids) as Array<{ id: string }>;
      for (const row of fetched) entityMap.set(row.id, rowToEntity(row));
    }

    return topFacts.map((f) => {
      const subj = entityMap.get(f.subjectId)?.name ?? f.subjectId;
      let obj: string;
      if (f.objectId) {
        const e = entityMap.get(f.objectId);
        obj = e
          ? e.name + (f.objectLiteral ? ` / "${f.objectLiteral}"` : "")
          : f.objectId;
      } else {
        obj = f.objectLiteral ? `"${f.objectLiteral}"` : "";
      }
      return `${subj} ${f.predicate} ${obj}`;
    });
  }

  /** All stat entries for an entity as observer (all targets) */
  allStatsFor(chatId: string, observerId: string): DbRelationshipStat[] {
    return this.db
      .prepare("SELECT * FROM relationship_stats WHERE chat_id = ? AND observer_id = ? ORDER BY target_id")
      .all(chatId, observerId)
      .map(rowToStat);
  }

  /** Get stat names that are actually set for a pair */
  presentStatNames(chatId: string, observerId: string, targetId: string): StatName[] {
    return (
      this.db
        .prepare(
          "SELECT stat_name FROM relationship_stats WHERE chat_id = ? AND observer_id = ? AND target_id = ?"
        )
        .all(chatId, observerId, targetId) as Array<{ stat_name: string }>
    ).map((r) => r.stat_name as StatName);
  }
}

// Export stat names for convenience
export { STAT_NAMES };

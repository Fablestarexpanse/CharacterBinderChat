// ─── FableStore (TypeScript) ──────────────────────────────────────────────────
// TypeScript port of fable_drawer2/db.py using better-sqlite3.
// All operations are synchronous (better-sqlite3 is sync-first).

import Database, { type Database as DB } from "better-sqlite3";
import fs from "fs";
import path from "path";
import { CREATE_TABLES_SQL } from "./schema";
import { isSingleValued, normPredicate, predicateFamily } from "./predicates";
import { bufferToVec, cosine } from "@/lib/llm/embeddings";
import { contentWords, jaccard, normalizeText } from "@/lib/text/overlap";
import type { PersistedAppState } from "@/lib/types";
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
import { DEFAULT_DECAY_RATES } from "./models";

// ─── App state collections ────────────────────────────────────────────────────
// The flat collections of the durable app state, paired with their tables. Every
// place that reads, wipes, writes, validates or counts them drives off this list
// rather than repeating five near-identical statements — a new collection is one
// row here plus its table in the schema. Chats are absent on purpose: their
// messages live in a second table, so they are handled separately.

export const APP_COLLECTIONS = [
  ["characters", "app_characters"],
  ["personas",   "app_personas"],
  ["lorebooks",  "app_lorebooks"],
  ["scenarios",  "app_scenarios"],
  ["presets",    "app_presets"],
] as const satisfies ReadonlyArray<readonly [keyof PersistedAppState, string]>;

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
    ruptureRecovery: r.rupture_recovery ?? 0,
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

  // The upgrade path for databases created before a column existed. Every
  // column here is also in CREATE_TABLES_SQL, which describes the real shape
  // of a fresh table; CREATE TABLE IF NOT EXISTS never alters an existing one,
  // so both are needed and they must agree.
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

      // Parameterized: this runs exactly once on irreplaceable legacy data,
      // and a quote in the chat id must not break the migration mid-transaction.
      this.db.prepare(`INSERT INTO entities (chat_id, id, type, name, description, created_at)
        SELECT ?, id, type, name, description, created_at FROM entities_v1`).run(target);
      // Columns added after v1 shipped. A v1 database may or may not have
      // them, and leaving one out of the copy silently resets it — every
      // fact's importance back to the 0.5 default, every open rupture healed.
      const carry = (table: string, col: string) =>
        (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
          .some((c) => c.name === col) ? `, ${col}` : "";
      const factImportance  = carry("facts_v1", "importance");
      const cardImportance  = carry("memory_cards_v1", "importance");
      const statRupture     = carry("relationship_stats_v1", "rupture_recovery");

      // Fact ids preserved so superseded_by links stay valid
      this.db.prepare(`INSERT INTO facts (id, chat_id, subject_id, predicate, object_id, object_literal,
          t_valid_start, t_valid_end, t_ingested, confidence, known_to, superseded_by${factImportance})
        SELECT id, ?, subject_id, predicate, object_id, object_literal,
          t_valid_start, t_valid_end, t_ingested, confidence, known_to, superseded_by${factImportance} FROM facts_v1`).run(target);
      this.db.prepare(`INSERT INTO relationship_stats (chat_id, observer_id, target_id, stat_name, value, decay_rate, last_updated${statRupture})
        SELECT ?, observer_id, target_id, stat_name, value, decay_rate, last_updated${statRupture} FROM relationship_stats_v1`).run(target);
      this.db.prepare(`INSERT INTO memory_cards (chat_id, title, content, tags, entity_ids, created_at, updated_at${cardImportance})
        SELECT ?, title, content, tags, entity_ids, created_at, updated_at${cardImportance} FROM memory_cards_v1`).run(target);
      this.db.prepare(`INSERT INTO commitments (chat_id, promisor_id, promisee_id, description, status, created_at, resolved_at)
        SELECT ?, promisor_id, promisee_id, description, status, created_at, resolved_at FROM commitments_v1`).run(target);
      this.db.prepare(`INSERT INTO core_memory (chat_id, character_id, data, version, updated_at)
        SELECT ?, character_id, data, version, updated_at FROM core_memory_v1`).run(target);

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

  // ── Entities ──────────────────────────────────────────────────────────────
  // All memory operations are scoped by chatId: each chat is its own story.

  /** INSERT OR REPLACE — overwrites the name and description of an existing row. */
  insertEntity(chatId: string, entity: Omit<DbEntity, "createdAt"> & { createdAt?: number }): void {
    const createdAt = entity.createdAt ?? now();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO entities (chat_id, id, type, name, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(chatId, entity.id, entity.type, entity.name, entity.description ?? "", createdAt);
  }

  /**
   * Get-or-create: returns the existing row untouched when the id is already
   * present. Use insertEntity to overwrite an entity's name or description.
   */
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

  /** Raw embedding blob for a memory card (null when never embedded) */
  cardEmbedding(cardId: number): Float32Array | null {
    const row = this.db.prepare("SELECT embedding FROM memory_cards WHERE id = ?").get(cardId) as
      { embedding: Buffer | null } | undefined;
    return bufferToVec(row?.embedding ?? null);
  }

  /**
   * Embeddings for many rows in one query. Retrieval scores every candidate,
   * so the per-row accessors above meant one SQLite round trip per fact —
   * from inside a sort comparator, so the count was O(n log n), not O(n).
   */
  embeddings(table: "facts" | "memory_cards", ids: number[]): Map<number, Float32Array> {
    const map = new Map<number, Float32Array>();
    if (ids.length === 0) return map;
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT id, embedding FROM ${table} WHERE id IN (${placeholders})`)
      .all(...ids) as Array<{ id: number; embedding: Buffer | null }>;
    for (const row of rows) {
      const vec = bufferToVec(row.embedding);
      if (vec) map.set(row.id, vec);
    }
    return map;
  }

  /** Entities by id, in one query — retrieval renders many facts at once. */
  getEntities(chatId: string, ids: string[]): Map<string, DbEntity> {
    const map = new Map<string, DbEntity>();
    if (ids.length === 0) return map;
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM entities WHERE chat_id = ? AND id IN (${placeholders})`)
      .all(chatId, ...ids) as Array<{ id: string }>;
    for (const row of rows) map.set(row.id, rowToEntity(row));
    return map;
  }

  setCardEmbedding(cardId: number, embedding: Buffer): void {
    this.db.prepare("UPDATE memory_cards SET embedding = ? WHERE id = ?").run(embedding, cardId);
  }

  /** Raw embedding blob for a fact (null when never embedded) */
  factEmbedding(factId: number): Float32Array | null {
    const row = this.db.prepare("SELECT embedding FROM facts WHERE id = ?").get(factId) as
      { embedding: Buffer | null } | undefined;
    return bufferToVec(row?.embedding ?? null);
  }

  /**
   * Among a subject's OLDER live facts (excluding the given ids), find one
   * semantically near-identical to `vec` — a restatement. Same-family facts
   * fold at `threshold`; cross-family only at near-identity (0.97), because
   * negation pairs ("trusts" vs "distrusts") embed close enough to clear a
   * looser bar and folding those would erase a genuine reversal.
   */
  findSimilarLiveFact(
    chatId:     string,
    subjectId:  string,
    predicate:  string,
    vec:        Float32Array,
    excludeIds: Set<number>,
    threshold = 0.92
  ): DbFact | null {
    const family = predicateFamily(predicate);
    for (const f of this.queryFacts(chatId, subjectId)) {
      if (excludeIds.has(f.id)) continue;
      const other = this.factEmbedding(f.id);
      if (!other) continue;
      const sim = cosine(vec, other);
      const bar = predicateFamily(f.predicate) === family ? threshold : 0.97;
      if (sim >= bar) return f;
    }
    return null;
  }

  /** Raise (never lower) a fact's importance — used when a restatement folds
   *  into it so the survivor keeps the highest score either version earned. */
  raiseFactImportance(factId: number, importance: number): void {
    this.db
      .prepare("UPDATE facts SET importance = MAX(importance, ?) WHERE id = ?")
      .run(Math.max(0, Math.min(1, importance)), factId);
  }

  /**
   * Write a fact while keeping the single-valued-predicate invariant: at most
   * one live fact per (subject, predicate family) unless the family is
   * multi-valued.
   *
   * Both write paths — the manual facts route and the extractor — need this,
   * and they each had their own copy, which is exactly how one of them can
   * start drifting from the table's own rule. Matching is by predicate FAMILY,
   * so `lives_at` / `located_at` / `current_location` supersede one another
   * instead of accumulating, and by object key as well, because family alone
   * folded siblings of a multi-valued predicate together ("knows kael"
   * superseding "knows elen").
   *
   * `duplicate` means an equivalent live fact already existed; nothing was
   * written and `factId` is that existing fact.
   */
  assertFact(chatId: string, fact: {
    subjectId:     string;
    predicate:     string;
    objectId?:     string | null;
    objectLiteral?:string | null;
    confidence?:   number;
    importance?:   number;
    knownTo?:      string[];
  }): { factId: number; duplicate: boolean; superseded: number[] } {
    const family      = predicateFamily(fact.predicate);
    const objectKey   = fact.objectId ?? (fact.objectLiteral ?? "").toLowerCase().trim();
    const sameFamily  = (p: string) => predicateFamily(p) === family;
    const keyOf       = (f: DbFact) => f.objectId ?? (f.objectLiteral ?? "").toLowerCase().trim();

    // One query serves both the duplicate check and the supersession scan
    const existing = this.queryFacts(chatId, fact.subjectId);

    const duplicate = existing.find((ex) => sameFamily(ex.predicate) && keyOf(ex) === objectKey);
    if (duplicate) return { factId: duplicate.id, duplicate: true, superseded: [] };

    const toSupersede = isSingleValued(fact.predicate)
      ? existing.filter((ex) => sameFamily(ex.predicate) && keyOf(ex) !== objectKey)
      : [];

    const factId = this.insertFact(chatId, { ...fact, predicate: normPredicate(fact.predicate) });
    for (const old of toSupersede) this.supersedeFact(old.id, factId);

    return { factId, duplicate: false, superseded: toSupersede.map((f) => f.id) };
  }

  supersedeFact(oldId: number, newId: number, atTime?: number): void {
    const t = atTime ?? now();
    this.db
      .prepare("UPDATE facts SET t_valid_end = ?, superseded_by = ? WHERE id = ?")
      .run(t, newId, oldId);
  }

  /**
   * Hard-delete a fact the user rejected. This is for extraction mistakes —
   * things that were never true — so the row goes rather than being closed.
   * Anything this fact superseded is revived: the successor that closed it no
   * longer exists, and leaving the predecessor closed would erase both
   * versions of the truth and dangle superseded_by.
   */
  deleteFact(chatId: string, factId: number): { deleted: boolean; revived: number } {
    const exists = this.db
      .prepare("SELECT id FROM facts WHERE id = ? AND chat_id = ?")
      .get(factId, chatId);
    if (!exists) return { deleted: false, revived: 0 };

    const tx = this.db.transaction(() => {
      const revived = this.db
        .prepare(
          "UPDATE facts SET t_valid_end = NULL, superseded_by = NULL WHERE superseded_by = ? AND chat_id = ?"
        )
        .run(factId, chatId).changes;
      this.db.prepare("DELETE FROM facts WHERE id = ? AND chat_id = ?").run(factId, chatId);
      return revived;
    });
    return { deleted: true, revived: tx() };
  }


  // ── Relationship Stats ────────────────────────────────────────────────────

  /**
   * Write a stat's value, and optionally its rupture window, in one statement.
   *
   * `ruptureRecovery` is deliberately part of the same write: the two describe
   * one row, and updating them separately meant a single stat change ran four
   * statements — read, upsert, read back, update.
   */
  setStat(
    chatId:     string,
    observerId: string,
    targetId:   string,
    statName:   StatName,
    value:      number,
    ruptureRecovery?: number
  ): DbRelationshipStat {
    const decayRate = DEFAULT_DECAY_RATES[statName];
    const t = now();
    this.db
      .prepare(
        `INSERT INTO relationship_stats
           (chat_id, observer_id, target_id, stat_name, value, decay_rate, rupture_recovery, last_updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(chat_id, observer_id, target_id, stat_name)
         DO UPDATE SET
           value            = excluded.value,
           rupture_recovery = COALESCE(?, relationship_stats.rupture_recovery),
           last_updated     = excluded.last_updated`
      )
      .run(chatId, observerId, targetId, statName, value, decayRate,
           ruptureRecovery ?? 0, t, ruptureRecovery ?? null);

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
    const recovery   = existing?.ruptureRecovery ?? 0;
    const inRecovery = recovery > 0;

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

    // A big hit opens a recovery window; positive movement consumes it one
    // step at a time. Written with the value, not after it.
    let nextRecovery: number | undefined;
    if (bondStat) {
      if (effective <= -12) nextRecovery = 6;
      else if (delta > 0 && inRecovery) nextRecovery = recovery - 1;
    }

    return this.setStat(chatId, observerId, targetId, statName,
      Math.max(-100, Math.min(100, current + effective)), nextRecovery);
  }

  /** True while any bond stat of the pair is inside its post-rupture window */
  isRecentlyRuptured(chatId: string, observerId: string, targetId: string): boolean {
    const stats = this.queryStats(chatId, observerId, targetId);
    return (["trust", "affection", "connection"] as const)
      .some((name) => (stats[name]?.ruptureRecovery ?? 0) > 0);
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

  // ── Shared language (bond cards) ──────────────────────────────────────────
  // Running gags, nicknames, rituals, pet phrases — the texture of a long
  // relationship. Stored as memory_cards tagged "bond". Soak #3 showed the
  // extractor re-emitting these as ~200 duplicate "commitments"; giving them
  // their own reinforced type is the fix: a re-mention strengthens the
  // existing card instead of inserting a copy.

  /**
   * Insert a shared-language card, or reinforce an existing near-duplicate
   * (content-word Jaccard ≥ 0.5). Reinforcement bumps importance so the bits
   * a pair actually keeps using rise to the top of the injected list.
   */
  upsertBondCard(chatId: string, kind: string, text: string): { id: number; reinforced: boolean } {
    const incoming = contentWords(text);
    const incomingNorm = normalizeText(text);

    // Lightweight query — no embedding BLOBs, bond cards only. Scanning
    // listMemoryCards here pulled every episode's ~3KB vector per bit.
    const existing = this.db
      .prepare(`SELECT id, title, content FROM memory_cards WHERE chat_id = ? AND tags LIKE '%"bond"%'`)
      .all(chatId) as Array<{ id: number; title: string; content: string }>;

    for (const card of existing) {
      if (card.title !== kind) continue; // a "joke" never folds into a "ritual"
      const dup = incoming.size === 0
        // Short texts ("Pip") have no content words — compare whole strings,
        // else every re-mention of a short nickname inserts a fresh card
        ? normalizeText(card.content) === incomingNorm
        : jaccard(incoming, contentWords(card.content)) >= 0.5;
      if (dup) {
        this.db
          .prepare("UPDATE memory_cards SET importance = MIN(1.0, importance + 0.1), updated_at = ? WHERE id = ?")
          .run(now(), card.id);
        return { id: card.id, reinforced: true };
      }
    }
    const id = this.insertMemoryCard(chatId, {
      title: kind, content: text, tags: ["bond", kind], entityIds: [], importance: 0.4,
    });
    return { id, reinforced: false };
  }

  /** Bond cards, strongest (most-reinforced) first. */
  listBondCards(chatId: string, limit = 6): DbMemoryCard[] {
    return this.listMemoryCards(chatId)
      .filter((c) => c.tags.includes("bond"))
      .sort((a, b) => b.importance - a.importance || b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  listMemoryCards(chatId: string, entityId?: string): DbMemoryCard[] {
    const rows = this.db
      .prepare("SELECT * FROM memory_cards WHERE chat_id = ? ORDER BY created_at DESC")
      .all(chatId)
      .map(rowToMemoryCard);
    if (!entityId) return rows;
    return rows.filter((c) => c.entityIds.includes(entityId));
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

  /** Small singleton values that aren't collections (default preset, global
   *  instructions). Upserted rather than wiped so a client that omits one
   *  doesn't null it. */
  private getKv<T>(key: string, fallback: T): T {
    const row = this.db.prepare("SELECT value FROM app_kv WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  getAppState(): PersistedAppState {
    const read = (table: string) =>
      (this.db.prepare(`SELECT data FROM ${table} ORDER BY seq`).all() as Array<{ data: string }>)
        .map((r) => JSON.parse(r.data));

    const chatRows = this.db
      .prepare("SELECT id, data FROM app_chats ORDER BY seq")
      .all() as Array<{ id: string; data: string }>;
    const msgStmt = this.db.prepare(
      "SELECT data FROM app_messages WHERE chat_id = ? ORDER BY seq"
    );
    const chats = chatRows.map((row) => ({
      ...(JSON.parse(row.data) as Record<string, unknown>),
      messages: (msgStmt.all(row.id) as Array<{ data: string }>).map((m) => JSON.parse(m.data)),
    })) as PersistedAppState["chats"];

    return {
      characters: read("app_characters"),
      personas:   read("app_personas"),
      lorebooks:  read("app_lorebooks"),
      scenarios:  read("app_scenarios"),
      presets:    read("app_presets"),
      chats,
      defaultPresetId:    this.getKv<string | null>("defaultPresetId", null),
      globalInstructions: this.getKv<PersistedAppState["globalInstructions"]>("globalInstructions", {}),
    };
  }

  /** `defaultPresetId`/`globalInstructions` omitted (undefined) means "leave as-is". */
  replaceAppState(state: Partial<PersistedAppState> &
    Pick<PersistedAppState, "characters" | "chats">): void {
    const { chats, defaultPresetId, globalInstructions } = state;

    const tx = this.db.transaction(() => {
      for (const [field, table] of APP_COLLECTIONS) {
        this.db.prepare(`DELETE FROM ${table}`).run();
        const ins = this.db.prepare(
          `INSERT OR REPLACE INTO ${table} (id, seq, data) VALUES (?, ?, ?)`
        );
        (state[field] ?? []).forEach((row, i) => ins.run(row.id, i, JSON.stringify(row)));
      }

      // app_kv is upserted, never cleared — an older client that doesn't send
      // these fields must not wipe them.
      const insKv = this.db.prepare(
        "INSERT OR REPLACE INTO app_kv (key, value) VALUES (?, ?)"
      );
      if (defaultPresetId !== undefined) insKv.run("defaultPresetId", JSON.stringify(defaultPresetId));
      if (globalInstructions !== undefined) insKv.run("globalInstructions", JSON.stringify(globalInstructions));

      // Chats are the one collection that isn't flat: messages live in their
      // own table, keyed by chat, so they are cleared and written together.
      this.db.prepare("DELETE FROM app_chats").run();
      this.db.prepare("DELETE FROM app_messages").run();
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
      // importance and embedding must ride along: dropping them reset every
      // transferred fact to 0.5 (losing its retrieval rank) and silently
      // downgraded transferred chats to lexical-only retrieval forever.
      const ins = this.db.prepare(
        `INSERT INTO facts (chat_id, subject_id, predicate, object_id, object_literal,
           t_valid_start, t_valid_end, t_ingested, confidence, importance, embedding, known_to, superseded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      );
      const srcEmbedding = this.db.prepare("SELECT embedding FROM facts WHERE id = ?");
      for (const f of srcFacts) {
        const emb = (srcEmbedding.get(f.id) as { embedding: Buffer | null } | undefined)?.embedding ?? null;
        const info = ins.run(
          toChatId, f.subjectId, f.predicate, f.objectId, f.objectLiteral,
          f.tValidStart, f.tValidEnd, f.tIngested, f.confidence, f.importance, emb, JSON.stringify(f.knownTo)
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
        `INSERT INTO memory_cards (chat_id, title, content, tags, entity_ids, importance, embedding, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const srcCardEmb = this.db.prepare("SELECT embedding FROM memory_cards WHERE id = ?");
      for (const c of srcCards) {
        const emb = (srcCardEmb.get(c.id) as { embedding: Buffer | null } | undefined)?.embedding ?? null;
        insCard.run(toChatId, c.title, c.content, JSON.stringify(c.tags), JSON.stringify(c.entityIds), c.importance, emb, c.createdAt, c.updatedAt);
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


}

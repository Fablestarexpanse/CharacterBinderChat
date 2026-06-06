// ─── FableStore (TypeScript) ──────────────────────────────────────────────────
// TypeScript port of fable_drawer2/db.py using better-sqlite3.
// All operations are synchronous (better-sqlite3 is sync-first).

import Database, { type Database as DB } from "better-sqlite3";
import fs from "fs";
import path from "path";
import { CREATE_TABLES_SQL } from "./schema";
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
    id:        r.id,
    title:     r.title,
    content:   r.content,
    tags:      r.tags ? (JSON.parse(r.tags) as string[]) : [],
    entityIds: r.entity_ids ? (JSON.parse(r.entity_ids) as string[]) : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
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
    this._initSchema();
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
      } catch {
        // Ignore "already exists" errors from indexes etc.
      }
    }
  }

  close(): void {
    this.db.close();
  }

  // ── Entities ──────────────────────────────────────────────────────────────

  insertEntity(entity: Omit<DbEntity, "createdAt"> & { createdAt?: number }): void {
    const createdAt = entity.createdAt ?? now();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO entities (id, type, name, description, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(entity.id, entity.type, entity.name, entity.description ?? "", createdAt);
  }

  /** Upsert — safe to call even if entity already exists */
  ensureEntity(
    id: string,
    type: EntityType,
    name: string,
    description = ""
  ): DbEntity {
    const existing = this.getEntity(id);
    if (existing) return existing;
    const e: DbEntity = { id, type, name, description, createdAt: now() };
    this.insertEntity(e);
    return e;
  }

  getEntity(id: string): DbEntity | null {
    const row = this.db
      .prepare("SELECT * FROM entities WHERE id = ?")
      .get(id);
    return row ? rowToEntity(row) : null;
  }

  listEntities(type?: EntityType): DbEntity[] {
    const rows = type
      ? this.db.prepare("SELECT * FROM entities WHERE type = ? ORDER BY name").all(type)
      : this.db.prepare("SELECT * FROM entities ORDER BY type, name").all();
    return rows.map(rowToEntity);
  }

  // ── Facts ─────────────────────────────────────────────────────────────────

  insertFact(fact: {
    subjectId:     string;
    predicate:     string;
    objectId?:     string | null;
    objectLiteral?:string | null;
    confidence?:   number;
    knownTo?:      string[];
    tValidStart?:  number;
  }): number {
    const t = now();
    const stmt = this.db.prepare(
      `INSERT INTO facts
         (subject_id, predicate, object_id, object_literal,
          t_valid_start, t_valid_end, t_ingested,
          confidence, known_to, superseded_by)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL)`
    );
    const info = stmt.run(
      fact.subjectId,
      fact.predicate,
      fact.objectId ?? null,
      fact.objectLiteral ?? null,
      fact.tValidStart ?? t,
      t,
      fact.confidence ?? 1.0,
      JSON.stringify(fact.knownTo ?? []),
    );
    return info.lastInsertRowid as number;
  }

  /**
   * Query facts valid at a given time (defaults to now).
   * Uses temporal-only filter — superseded facts are already excluded because
   * supersede_fact() sets t_valid_end, which the temporal query handles.
   */
  queryFacts(subjectId: string, asOfTime?: number): DbFact[] {
    const t = asOfTime ?? now();
    const rows = this.db
      .prepare(
        `SELECT * FROM facts
         WHERE subject_id = ?
           AND t_valid_start <= ?
           AND (t_valid_end IS NULL OR t_valid_end > ?)
         ORDER BY t_valid_start`
      )
      .all(subjectId, t, t);
    return rows.map(rowToFact);
  }

  queryFactsIncludingSuperseded(subjectId: string): DbFact[] {
    const rows = this.db
      .prepare("SELECT * FROM facts WHERE subject_id = ? ORDER BY t_valid_start")
      .all(subjectId);
    return rows.map(rowToFact);
  }

  supersedeFact(oldId: number, newId: number, atTime?: number): void {
    const t = atTime ?? now();
    this.db
      .prepare("UPDATE facts SET t_valid_end = ?, superseded_by = ? WHERE id = ?")
      .run(t, newId, oldId);
  }

  /** Facts where this entity appears as the *object* */
  queryFactsAboutAsObject(entityId: string, asOfTime?: number): DbFact[] {
    const t = asOfTime ?? now();
    const rows = this.db
      .prepare(
        `SELECT * FROM facts
         WHERE object_id = ?
           AND t_valid_start <= ?
           AND (t_valid_end IS NULL OR t_valid_end > ?)
         ORDER BY t_valid_start`
      )
      .all(entityId, t, t);
    return rows.map(rowToFact);
  }

  findContradictions(): Array<[DbFact, DbFact]> {
    const t = now();
    const rows = this.db
      .prepare(
        `SELECT * FROM facts
         WHERE t_valid_start <= ?
           AND (t_valid_end IS NULL OR t_valid_end > ?)
         ORDER BY subject_id, predicate, t_valid_start`
      )
      .all(t, t)
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
    observerId: string,
    targetId:   string,
    statName:   StatName,
    value:      number
  ): DbRelationshipStat {
    const decayRate = DEFAULT_DECAY_RATES[statName];
    const t = now();
    this.db
      .prepare(
        `INSERT INTO relationship_stats (observer_id, target_id, stat_name, value, decay_rate, last_updated)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(observer_id, target_id, stat_name)
         DO UPDATE SET value = excluded.value, last_updated = excluded.last_updated`
      )
      .run(observerId, targetId, statName, value, decayRate, t);

    return this.getStat(observerId, targetId, statName)!;
  }

  deltaStat(
    observerId: string,
    targetId:   string,
    statName:   StatName,
    delta:      number
  ): DbRelationshipStat {
    const existing = this.getStat(observerId, targetId, statName);
    const current  = existing?.value ?? 0;
    return this.setStat(observerId, targetId, statName, Math.max(-100, Math.min(100, current + delta)));
  }

  getStat(
    observerId: string,
    targetId:   string,
    statName:   StatName
  ): DbRelationshipStat | null {
    const row = this.db
      .prepare(
        "SELECT * FROM relationship_stats WHERE observer_id = ? AND target_id = ? AND stat_name = ?"
      )
      .get(observerId, targetId, statName);
    return row ? rowToStat(row) : null;
  }

  queryStats(
    observerId: string,
    targetId:   string
  ): Partial<Record<StatName, DbRelationshipStat>> {
    const rows = this.db
      .prepare(
        "SELECT * FROM relationship_stats WHERE observer_id = ? AND target_id = ?"
      )
      .all(observerId, targetId);
    const result: Partial<Record<StatName, DbRelationshipStat>> = {};
    for (const row of rows) {
      const s = rowToStat(row);
      result[s.statName] = s;
    }
    return result;
  }

  /** Return all unique (observer, target) pairs that have any stats */
  allStatPairs(): Array<{ observerId: string; targetId: string }> {
    const rows = this.db
      .prepare(
        "SELECT DISTINCT observer_id, target_id FROM relationship_stats"
      )
      .all() as Array<{ observer_id: string; target_id: string }>;
    return rows.map((r) => ({ observerId: r.observer_id, targetId: r.target_id }));
  }

  /**
   * Apply Ebbinghaus decay to all stats using each row's own last_updated
   * timestamp, so recently-updated stats decay less than stale ones.
   *
   * new_value = old_value × (1 − decay_rate)^(rowDays / 7)
   *
   * The `_daysElapsed` parameter is retained for API compatibility but is
   * no longer used — per-row elapsed time is always computed from last_updated.
   */
  applyDecay(_daysElapsed?: number): Array<{
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

  insertMemoryCard(card: Omit<DbMemoryCard, "id" | "createdAt" | "updatedAt">): number {
    const t = now();
    const info = this.db
      .prepare(
        `INSERT INTO memory_cards (title, content, tags, entity_ids, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        card.title,
        card.content,
        JSON.stringify(card.tags ?? []),
        JSON.stringify(card.entityIds ?? []),
        t, t,
      );
    return info.lastInsertRowid as number;
  }

  listMemoryCards(entityId?: string): DbMemoryCard[] {
    const rows = this.db
      .prepare("SELECT * FROM memory_cards ORDER BY created_at DESC")
      .all()
      .map(rowToMemoryCard);
    if (!entityId) return rows;
    return rows.filter((c) => c.entityIds.includes(entityId));
  }

  // ── Commitments ───────────────────────────────────────────────────────────

  insertCommitment(
    promisorId:  string,
    description: string,
    promiseeId?: string
  ): number {
    const t = now();
    const info = this.db
      .prepare(
        `INSERT INTO commitments (promisor_id, promisee_id, description, status, created_at, resolved_at)
         VALUES (?, ?, ?, 'active', ?, NULL)`
      )
      .run(promisorId, promiseeId ?? null, description, t);
    return info.lastInsertRowid as number;
  }

  listCommitments(entityId: string, status?: CommitmentStatus): DbCommitment[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM commitments WHERE promisor_id = ? ORDER BY created_at DESC"
      )
      .all(entityId)
      .map(rowToCommitment);
    return status ? rows.filter((c) => c.status === status) : rows;
  }

  // ── Character Summary ─────────────────────────────────────────────────────

  characterSummary(entityId: string): CharacterSummaryData {
    const entity = this.getEntity(entityId);
    const facts  = this.queryFacts(entityId);

    // Collect all unique targets this entity has stats with
    const statRows = this.db
      .prepare(
        "SELECT * FROM relationship_stats WHERE observer_id = ? ORDER BY target_id, stat_name"
      )
      .all(entityId)
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
      const targetEntity = this.getEntity(targetId);
      return {
        targetId,
        targetName: targetEntity?.name ?? targetId,
        stats:      data.stats,
      };
    });

    const commitments = this.listCommitments(entityId, "active");

    return {
      entity,
      relationships,
      facts: facts.map((f) => {
        const objectEntity = f.objectId ? this.getEntity(f.objectId) : null;
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

  // ── Core Memory (Drawer 1) ────────────────────────────────────────────────

  getCoreMemory(characterId: string): DbCoreMemory | null {
    const row = this.db
      .prepare("SELECT * FROM core_memory WHERE character_id = ?")
      .get(characterId) as { character_id: string; data: string; version: number; updated_at: number } | undefined;
    if (!row) return null;
    return {
      characterId: row.character_id,
      data:        JSON.parse(row.data) as CoreMemory,
      version:     row.version,
      updatedAt:   row.updated_at,
    };
  }

  setCoreMemory(cm: CoreMemory): void {
    const t = now();
    this.db
      .prepare(
        `INSERT INTO core_memory (character_id, data, version, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(character_id)
         DO UPDATE SET data = excluded.data, version = excluded.version, updated_at = excluded.updated_at`
      )
      .run(cm.characterId, JSON.stringify({ ...cm, updatedAt: new Date(t * 1000).toISOString() }), cm.version ?? 1, t);
  }

  /** Partial update — merges top-level keys only (not nested objects) */
  patchCoreMemory(characterId: string, patch: Partial<CoreMemory>): DbCoreMemory | null {
    const existing = this.getCoreMemory(characterId);
    if (!existing) return null;
    const merged: CoreMemory = { ...existing.data, ...patch, characterId };
    merged.version = (existing.version ?? 0) + 1;
    this.setCoreMemory(merged);
    return this.getCoreMemory(characterId);
  }

  /** Returns existing core memory or creates a default one */
  ensureCoreMemory(characterId: string, characterName: string): DbCoreMemory {
    const existing = this.getCoreMemory(characterId);
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
    this.setCoreMemory(defaults);
    return this.getCoreMemory(characterId)!;
  }

  // ── Export ────────────────────────────────────────────────────────────────

  exportJson(): {
    entities:    DbEntity[];
    facts:       DbFact[];
    stats:       DbRelationshipStat[];
    memoryCards: DbMemoryCard[];
    commitments: DbCommitment[];
  } {
    return {
      entities:    this.listEntities(),
      facts:       this.db.prepare("SELECT * FROM facts ORDER BY id").all().map(rowToFact),
      stats:       this.db.prepare("SELECT * FROM relationship_stats ORDER BY id").all().map(rowToStat),
      memoryCards: this.listMemoryCards(),
      commitments: this.db.prepare("SELECT * FROM commitments ORDER BY id").all().map(rowToCommitment),
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Resolve a fact's object to a display string */
  factObjectDisplay(fact: DbFact): string {
    if (fact.objectId) {
      const e = this.getEntity(fact.objectId);
      if (e) return e.name + (fact.objectLiteral ? ` / "${fact.objectLiteral}"` : "");
      return fact.objectId;
    }
    return fact.objectLiteral ? `"${fact.objectLiteral}"` : "";
  }

  /**
   * Retrieve the most salient currently-valid facts for a character,
   * for injection into the system prompt. Salience = confidence, with a
   * recency tiebreak (newer tValidStart ranks higher). Returns formatted
   * "subject predicate object" lines.
   */
  retrieveFactsForPrompt(characterId: string, limit = 12): string[] {
    const asSubject = this.queryFacts(characterId);
    const asObject  = this.queryFactsAboutAsObject(characterId);

    // Dedup by fact id
    const seen = new Set<number>();
    const all = [...asSubject, ...asObject].filter((f) => {
      if (seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    });

    all.sort((a, b) =>
      (b.confidence - a.confidence) || (b.tValidStart - a.tValidStart)
    );

    const topFacts = all.slice(0, limit);

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fetched = this.db
        .prepare(`SELECT * FROM entities WHERE id IN (${placeholders})`)
        .all(...ids) as any[];
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
  allStatsFor(observerId: string): DbRelationshipStat[] {
    return this.db
      .prepare("SELECT * FROM relationship_stats WHERE observer_id = ? ORDER BY target_id")
      .all(observerId)
      .map(rowToStat);
  }

  /** Get stat names that are actually set for a pair */
  presentStatNames(observerId: string, targetId: string): StatName[] {
    return (
      this.db
        .prepare(
          "SELECT stat_name FROM relationship_stats WHERE observer_id = ? AND target_id = ?"
        )
        .all(observerId, targetId) as Array<{ stat_name: string }>
    ).map((r) => r.stat_name as StatName);
  }
}

// Export stat names for convenience
export { STAT_NAMES };

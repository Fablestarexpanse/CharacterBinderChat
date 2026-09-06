import type {
  DbEntity, DbFact, DbRelationshipStat, DbMemoryCard, DbCommitment,
  EntityType, StatName, CommitmentStatus,
} from "./models";

// ─── Row → Model mappers ──────────────────────────────────────────────────────
// The row shapes, spelled out. better-sqlite3 returns `unknown` from .all(),
// so a cast happens somewhere; each mapper makes exactly one, to a declared
// row shape, rather than taking `any` and hoping. Fields nullable in SQLite are
// nullable here.

interface EntityRow {
  id: string; type: string; name: string; description: string | null; created_at: number;
}
interface FactRow {
  id: number; subject_id: string; predicate: string;
  object_id: string | null; object_literal: string | null;
  t_valid_start: number; t_valid_end: number | null; t_ingested: number;
  confidence: number; importance: number | null;
  known_to: string | null; superseded_by: number | null;
}
interface StatRow {
  id: number; observer_id: string; target_id: string; stat_name: string;
  value: number; decay_rate: number; rupture_recovery: number | null; last_updated: number;
}
interface MemoryCardRow {
  id: number; title: string; content: string;
  tags: string | null; entity_ids: string | null; importance: number | null;
  created_at: number; updated_at: number;
}
interface CommitmentRow {
  id: number; promisor_id: string; promisee_id: string | null;
  description: string; status: string; created_at: number; resolved_at: number | null;
}

// A JSON column that fails to parse means a corrupted row, not a crash: the
// mappers return the empty list so one bad row can't take down a whole read.
function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as string[] : [];
  } catch {
    return [];
  }
}

export function rowToEntity(raw: unknown): DbEntity {
  const r = raw as EntityRow;
  return {
    id:          r.id,
    type:        r.type as EntityType,
    name:        r.name,
    description: r.description ?? "",
    createdAt:   r.created_at,
  };
}

export function rowToFact(raw: unknown): DbFact {
  const r = raw as FactRow;
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
    knownTo:       parseJsonArray(r.known_to),
    supersededBy:  r.superseded_by ?? null,
  };
}

export function rowToStat(raw: unknown): DbRelationshipStat {
  const r = raw as StatRow;
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

export function rowToMemoryCard(raw: unknown): DbMemoryCard {
  const r = raw as MemoryCardRow;
  return {
    id:         r.id,
    title:      r.title,
    content:    r.content,
    tags:       parseJsonArray(r.tags),
    entityIds:  parseJsonArray(r.entity_ids),
    importance: r.importance ?? 0.5,
    createdAt:  r.created_at,
    updatedAt:  r.updated_at,
  };
}

export function rowToCommitment(raw: unknown): DbCommitment {
  const r = raw as CommitmentRow;
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

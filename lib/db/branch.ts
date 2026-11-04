// ─── Memory branching ─────────────────────────────────────────────────────────
// "Branch from here" for a chat: the new chat starts with the memory the old one
// had at that message, not the memory it has now. Without this a branch made
// ten exchanges back would remember things that have not happened in its story.
//
// What is point-in-time and how:
//   • facts, entities, cards, commitments carry timestamps, so they are filtered
//     by a cutoff. A fact superseded only AFTER the cutoff is restored to
//     current, because in the branch the thing that replaced it never occurred.
//   • relationship stats and core memory are current-state only, so they come
//     from the memory_snapshots row saved when that message's extraction
//     finished. Branches from before snapshots existed (or from a message whose
//     extraction never finished) fall back to the live values and are reported
//     as `approximate` so the UI can say so instead of implying exactness.
//
// Memory is otherwise chat-scoped and never carries over implicitly — this, like
// transferMemory, is an explicit user action.

import type { Database as DB } from "better-sqlite3";

const now = () => Math.floor(Date.now() / 1000);

interface SnapshotData {
  core:  Array<{ character_id: string; data: string; version: number; updated_at: number }>;
  stats: Array<{
    observer_id: string; target_id: string; stat_name: string; value: number;
    decay_rate: number; rupture_recovery: number; last_updated: number;
  }>;
}

export function saveMemorySnapshot(db: DB, chatId: string, messageId: string): void {
  const data: SnapshotData = {
    core: db.prepare("SELECT character_id, data, version, updated_at FROM core_memory WHERE chat_id = ?")
      .all(chatId) as SnapshotData["core"],
    stats: db.prepare(
      `SELECT observer_id, target_id, stat_name, value, decay_rate, rupture_recovery, last_updated
         FROM relationship_stats WHERE chat_id = ?`
    ).all(chatId) as SnapshotData["stats"],
  };
  db.prepare(
    "INSERT OR REPLACE INTO memory_snapshots (chat_id, message_id, created_at, data) VALUES (?, ?, ?, ?)"
  ).run(chatId, messageId, now(), JSON.stringify(data));
}

export interface BranchMemoryInput {
  fromChatId: string;
  toChatId:   string;
  /** Ids of the SOURCE messages kept in the branch, oldest first. */
  keptMessageIds: string[];
  /**
   * Unix seconds: memory ingested after this is left out. Used when no snapshot
   * covers the branch point. null means "the branch point is the latest message",
   * so everything counts.
   */
  fallbackCutoff: number | null;
  /** Source message id → the id its copy has in the new chat. */
  messageIdMap: Record<string, string>;
}

export interface BranchMemoryResult {
  entities: number; facts: number; stats: number; cards: number; commitments: number;
  /** True when stats/core memory are live values rather than a snapshot. */
  approximate: boolean;
}

export function branchMemory(db: DB, input: BranchMemoryInput): BranchMemoryResult {
  const { fromChatId, toChatId, keptMessageIds, fallbackCutoff, messageIdMap } = input;
  const result: BranchMemoryResult = { entities: 0, facts: 0, stats: 0, cards: 0, commitments: 0, approximate: false };

  // Latest snapshot among the kept messages
  const findSnap = db.prepare("SELECT created_at, data FROM memory_snapshots WHERE chat_id = ? AND message_id = ?");
  let snap: { created_at: number; data: SnapshotData } | null = null;
  for (let i = keptMessageIds.length - 1; i >= 0 && !snap; i--) {
    const row = findSnap.get(fromChatId, keptMessageIds[i]) as { created_at: number; data: string } | undefined;
    if (row) {
      try { snap = { created_at: row.created_at, data: JSON.parse(row.data) as SnapshotData }; }
      catch { /* unreadable snapshot: treat as absent */ }
    }
  }

  const cutoff = snap ? snap.created_at : fallbackCutoff;
  result.approximate = !snap && fallbackCutoff !== null;
  const limit = cutoff ?? Number.MAX_SAFE_INTEGER;

  const tx = db.transaction(() => {
    // ── Facts: ingested by the cutoff, supersession restored when the superseder is dropped
    const facts = db
      .prepare("SELECT * FROM facts WHERE chat_id = ? AND t_ingested <= ? ORDER BY id")
      .all(fromChatId, limit) as Array<Record<string, unknown> & { id: number; superseded_by: number | null; t_valid_end: number | null }>;
    const kept = new Set(facts.map((f) => f.id));

    // ── Entities: those by the cutoff, plus any a copied fact points at (FK)
    const needed = new Set<string>();
    for (const f of facts) {
      needed.add(f.subject_id as string);
      if (f.object_id) needed.add(f.object_id as string);
    }
    const commitments = (db
      .prepare("SELECT * FROM commitments WHERE chat_id = ? AND created_at <= ? ORDER BY id")
      .all(fromChatId, limit)) as Array<Record<string, unknown>>;
    for (const c of commitments) {
      needed.add(c.promisor_id as string);
      if (c.promisee_id) needed.add(c.promisee_id as string);
    }
    const entities = (db
      .prepare("SELECT * FROM entities WHERE chat_id = ? ORDER BY created_at")
      .all(fromChatId)) as Array<{ id: string; type: string; name: string; description: string; created_at: number }>;
    const insEntity = db.prepare(
      "INSERT INTO entities (chat_id, id, type, name, description, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    for (const e of entities) {
      if (e.created_at <= limit || needed.has(e.id)) {
        insEntity.run(toChatId, e.id, e.type, e.name, e.description, e.created_at);
        result.entities++;
      }
    }

    // ── Facts, remapping ids so superseded_by points inside the copy
    const insFact = db.prepare(
      `INSERT INTO facts (chat_id, subject_id, predicate, object_id, object_literal,
         t_valid_start, t_valid_end, t_ingested, confidence, importance, known_to, embedding, superseded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    );
    const idMap = new Map<number, number>();
    for (const f of facts) {
      // The fact was replaced only after the branch point: in this timeline it
      // is still true, so reopen it.
      const reopened = f.superseded_by !== null && !kept.has(f.superseded_by);
      const info = insFact.run(
        toChatId, f.subject_id, f.predicate, f.object_id, f.object_literal,
        f.t_valid_start, reopened ? null : f.t_valid_end, f.t_ingested, f.confidence, f.importance,
        f.known_to, f.embedding,
      );
      idMap.set(f.id, info.lastInsertRowid as number);
      result.facts++;
    }
    const setSup = db.prepare("UPDATE facts SET superseded_by = ? WHERE id = ?");
    for (const f of facts) {
      if (f.superseded_by !== null && idMap.has(f.superseded_by)) {
        setSup.run(idMap.get(f.superseded_by)!, idMap.get(f.id)!);
      }
    }

    // ── Commitments: one resolved only after the cutoff was still open then
    const insCommit = db.prepare(
      `INSERT INTO commitments (chat_id, promisor_id, promisee_id, description, status, created_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of commitments) {
      const lateResolved = c.resolved_at !== null && (c.resolved_at as number) > limit;
      insCommit.run(
        toChatId, c.promisor_id, c.promisee_id, c.description,
        lateResolved ? "active" : c.status, c.created_at, lateResolved ? null : c.resolved_at,
      );
      result.commitments++;
    }

    // ── Scene cards
    const insCard = db.prepare(
      `INSERT INTO memory_cards (chat_id, title, content, tags, entity_ids, importance, embedding, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of db
      .prepare("SELECT * FROM memory_cards WHERE chat_id = ? AND created_at <= ? ORDER BY id")
      .all(fromChatId, limit) as Array<Record<string, unknown>>) {
      insCard.run(toChatId, c.title, c.content, c.tags, c.entity_ids, c.importance, c.embedding, c.created_at, c.updated_at);
      result.cards++;
    }

    // ── Stats and core memory: snapshot if there is one, else live
    const core = snap
      ? snap.data.core
      : db.prepare("SELECT character_id, data, version, updated_at FROM core_memory WHERE chat_id = ?")
          .all(fromChatId) as SnapshotData["core"];
    const stats = snap
      ? snap.data.stats
      : db.prepare(
          `SELECT observer_id, target_id, stat_name, value, decay_rate, rupture_recovery, last_updated
             FROM relationship_stats WHERE chat_id = ?`
        ).all(fromChatId) as SnapshotData["stats"];

    const insCore = db.prepare(
      "INSERT INTO core_memory (chat_id, character_id, data, version, updated_at) VALUES (?, ?, ?, ?, ?)"
    );
    for (const r of core) insCore.run(toChatId, r.character_id, r.data, r.version, r.updated_at);

    const insStat = db.prepare(
      `INSERT INTO relationship_stats
         (chat_id, observer_id, target_id, stat_name, value, decay_rate, rupture_recovery, last_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const s of stats) {
      insStat.run(toChatId, s.observer_id, s.target_id, s.stat_name, s.value, s.decay_rate, s.rupture_recovery ?? 0, s.last_updated);
      result.stats++;
    }

    // The branch inherits the snapshots of the messages it kept, re-keyed to
    // their new ids, so branching the branch from an earlier point stays exact.
    const copySnap = db.prepare(
      `INSERT OR REPLACE INTO memory_snapshots (chat_id, message_id, created_at, data)
       SELECT ?, ?, created_at, data FROM memory_snapshots WHERE chat_id = ? AND message_id = ?`
    );
    for (const oldId of keptMessageIds) {
      const newId = messageIdMap[oldId];
      if (newId) copySnap.run(toChatId, newId, fromChatId, oldId);
    }
  });
  tx();
  return result;
}

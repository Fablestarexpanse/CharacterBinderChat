// ─── Memory transfer ──────────────────────────────────────────────────────────
// Carrying a character's memories from one chat into another. Memory is
// chat-scoped by design — a new chat with the same character starts fresh — so
// this is the explicit, user-initiated exception, and it lives apart from the
// per-chat read/write paths for that reason.

import type { Database as DB } from "better-sqlite3";
import type { FableStore } from "./store";
import { rowToCommitment, rowToFact, rowToMemoryCard, rowToStat } from "./rows";

/**
 * Chats that hold memories involving a character — candidates for
 * "continue with memories" when starting a new chat with them.
 */
export function listMemorySources(db: DB, characterId: string): Array<{
  chatId: string; chatName: string | null; facts: number; updatedAt: number;
}> {
  const rows = db.prepare(`
    SELECT cm.chat_id AS chat_id,
           cm.updated_at AS updated_at,
           (SELECT COUNT(*) FROM facts f
             WHERE f.chat_id = cm.chat_id AND f.superseded_by IS NULL) AS facts
    FROM core_memory cm
    WHERE cm.character_id = ?
    ORDER BY cm.updated_at DESC
  `).all(characterId) as Array<{ chat_id: string; updated_at: number; facts: number }>;

  const nameOf = db.prepare("SELECT data FROM app_chats WHERE id = ?");
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
/**
 * Copy one chat's memory into another. Takes the store as well as the handle:
 * the entity and fact copies go through the store's own write paths (so
 * predicate canonicalisation and the witness stamp still apply), while the
 * commitment, card and core-memory copies are raw row moves.
 */
export function transferMemory(
  store: FableStore, db: DB, fromChatId: string, toChatId: string
): { entities: number; facts: number; stats: number } {
  let entities = 0, facts = 0, stats = 0;
  const tx = db.transaction(() => {
    // Entities — keep target's on collision
    for (const e of store.listEntities(fromChatId)) {
      if (!store.getEntity(toChatId, e.id)) {
        store.insertEntity(toChatId, e);
        entities++;
      }
    }

    // Facts — copy all (incl. superseded, preserving history), remap ids
    const srcFacts = db
      .prepare("SELECT * FROM facts WHERE chat_id = ? ORDER BY id")
      .all(fromChatId)
      .map(rowToFact);
    const idMap = new Map<number, number>();
    // importance and embedding must ride along: dropping them reset every
    // transferred fact to 0.5 (losing its retrieval rank) and silently
    // downgraded transferred chats to lexical-only retrieval forever.
    const ins = db.prepare(
      `INSERT INTO facts (chat_id, subject_id, predicate, object_id, object_literal,
         t_valid_start, t_valid_end, t_ingested, confidence, importance, embedding, known_to, superseded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    );
    const srcEmbedding = db.prepare("SELECT embedding FROM facts WHERE id = ?");
    for (const f of srcFacts) {
      const emb = (srcEmbedding.get(f.id) as { embedding: Buffer | null } | undefined)?.embedding ?? null;
      const info = ins.run(
        toChatId, f.subjectId, f.predicate, f.objectId, f.objectLiteral,
        f.tValidStart, f.tValidEnd, f.tIngested, f.confidence, f.importance, emb, JSON.stringify(f.knownTo)
      );
      idMap.set(f.id, info.lastInsertRowid as number);
      facts++;
    }
    const setSup = db.prepare("UPDATE facts SET superseded_by = ? WHERE id = ?");
    for (const f of srcFacts) {
      if (f.supersededBy !== null && idMap.has(f.supersededBy)) {
        setSup.run(idMap.get(f.supersededBy)!, idMap.get(f.id)!);
      }
    }

    // Stats — keep target's on collision
    const srcStats = db
      .prepare("SELECT * FROM relationship_stats WHERE chat_id = ?")
      .all(fromChatId)
      .map(rowToStat);
    const insStat = db.prepare(
      `INSERT OR IGNORE INTO relationship_stats
         (chat_id, observer_id, target_id, stat_name, value, decay_rate, last_updated)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const s of srcStats) {
      const r = insStat.run(toChatId, s.observerId, s.targetId, s.statName, s.value, s.decayRate, s.lastUpdated);
      if (r.changes > 0) stats++;
    }

    // Commitments and memory cards — straight copies
    const srcCommit = db.prepare("SELECT * FROM commitments WHERE chat_id = ?").all(fromChatId).map(rowToCommitment);
    const insCommit = db.prepare(
      `INSERT INTO commitments (chat_id, promisor_id, promisee_id, description, status, created_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of srcCommit) {
      insCommit.run(toChatId, c.promisorId, c.promiseeId, c.description, c.status, c.createdAt, c.resolvedAt);
    }
    const srcCards = db.prepare("SELECT * FROM memory_cards WHERE chat_id = ?").all(fromChatId).map(rowToMemoryCard);
    const insCard = db.prepare(
      `INSERT INTO memory_cards (chat_id, title, content, tags, entity_ids, importance, embedding, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const srcCardEmb = db.prepare("SELECT embedding FROM memory_cards WHERE id = ?");
    for (const c of srcCards) {
      const emb = (srcCardEmb.get(c.id) as { embedding: Buffer | null } | undefined)?.embedding ?? null;
      insCard.run(toChatId, c.title, c.content, JSON.stringify(c.tags), JSON.stringify(c.entityIds), c.importance, emb, c.createdAt, c.updatedAt);
    }

    // Core memory — only if the target has none yet
    const rows = db
      .prepare("SELECT * FROM core_memory WHERE chat_id = ?")
      .all(fromChatId) as Array<{ character_id: string; data: string; version: number; updated_at: number }>;
    for (const row of rows) {
      const exists = db
        .prepare("SELECT 1 FROM core_memory WHERE chat_id = ? AND character_id = ?")
        .get(toChatId, row.character_id);
      if (!exists) {
        db
          .prepare("INSERT INTO core_memory (chat_id, character_id, data, version, updated_at) VALUES (?, ?, ?, ?, ?)")
          .run(toChatId, row.character_id, row.data, row.version, row.updated_at);
      }
    }
  });
  tx();
  return { entities, facts, stats };
}

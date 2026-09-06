// ─── Schema v1 → v2 migration ─────────────────────────────────────────────────
// One-time upgrade logic, kept out of FableStore so the class reads as the
// query surface it is. Schema v1 keyed memory by character only, so every chat
// with a character shared one pool of facts and one core memory. v2 scopes
// everything by chat_id: each chat is its own story.

import type { Database as DB } from "better-sqlite3";

/**
 * Move a v1 database onto the v2 chat-scoped schema, if it is still on v1.
 * Legacy rows are assigned to the first existing chat belonging to the
 * character that owns the legacy core memory (in practice the demo chat they
 * came from), else to 'legacy'.
 *
 * `initSchema` is passed in rather than imported because it is the store's own
 * table creation, and the migration has to run it partway through: the v1
 * tables are renamed aside, the v2 tables created, then the rows copied over.
 */
export function migrateToChatScoped(db: DB, initSchema: () => void): void {
  const cols = db.prepare("PRAGMA table_info(entities)").all() as Array<{ name: string }>;
  if (cols.length === 0) return;                    // fresh DB — nothing to migrate
  if (cols.some((c) => c.name === "chat_id")) return; // already v2

  let target = "legacy";
  try {
    const cm = db.prepare("SELECT character_id FROM core_memory LIMIT 1").get() as
      { character_id: string } | undefined;
    if (cm) {
      const chats = db.prepare("SELECT id, data FROM app_chats ORDER BY seq").all() as
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

  db.pragma("foreign_keys = OFF");
  const migrate = db.transaction(() => {
    const OLD = ["entities", "facts", "relationship_stats", "memory_cards", "commitments", "core_memory"];
    for (const t of OLD) {
      db.exec(`ALTER TABLE ${t} RENAME TO ${t}_v1`);
    }
    initSchema(); // creates the v2 tables

    // Parameterized: this runs exactly once on irreplaceable legacy data,
    // and a quote in the chat id must not break the migration mid-transaction.
    db.prepare(`INSERT INTO entities (chat_id, id, type, name, description, created_at)
      SELECT ?, id, type, name, description, created_at FROM entities_v1`).run(target);
    // Columns added after v1 shipped. A v1 database may or may not have
    // them, and leaving one out of the copy silently resets it — every
    // fact's importance back to the 0.5 default, every open rupture healed.
    const carry = (table: string, col: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
        .some((c) => c.name === col) ? `, ${col}` : "";
    const factImportance  = carry("facts_v1", "importance");
    const cardImportance  = carry("memory_cards_v1", "importance");
    const statRupture     = carry("relationship_stats_v1", "rupture_recovery");

    // Fact ids preserved so superseded_by links stay valid
    db.prepare(`INSERT INTO facts (id, chat_id, subject_id, predicate, object_id, object_literal,
        t_valid_start, t_valid_end, t_ingested, confidence, known_to, superseded_by${factImportance})
      SELECT id, ?, subject_id, predicate, object_id, object_literal,
        t_valid_start, t_valid_end, t_ingested, confidence, known_to, superseded_by${factImportance} FROM facts_v1`).run(target);
    db.prepare(`INSERT INTO relationship_stats (chat_id, observer_id, target_id, stat_name, value, decay_rate, last_updated${statRupture})
      SELECT ?, observer_id, target_id, stat_name, value, decay_rate, last_updated${statRupture} FROM relationship_stats_v1`).run(target);
    db.prepare(`INSERT INTO memory_cards (chat_id, title, content, tags, entity_ids, created_at, updated_at${cardImportance})
      SELECT ?, title, content, tags, entity_ids, created_at, updated_at${cardImportance} FROM memory_cards_v1`).run(target);
    db.prepare(`INSERT INTO commitments (chat_id, promisor_id, promisee_id, description, status, created_at, resolved_at)
      SELECT ?, promisor_id, promisee_id, description, status, created_at, resolved_at FROM commitments_v1`).run(target);
    db.prepare(`INSERT INTO core_memory (chat_id, character_id, data, version, updated_at)
      SELECT ?, character_id, data, version, updated_at FROM core_memory_v1`).run(target);

    for (const t of OLD) {
      db.exec(`DROP TABLE ${t}_v1`);
    }
  });
  try {
    migrate();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

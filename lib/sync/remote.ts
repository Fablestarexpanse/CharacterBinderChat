// ─── Merging remote changes into the open tab ─────────────────────────────────
// What an open tab does with rows another writer changed (an agent through
// /api/cards, or another device). Pure, so the policy can be tested without a
// browser. The policy, and why:
//
//   • Shared content — characters, lorebooks, personas, scenarios, presets — the
//     SERVER's copy wins. These are what outside writers edit, and the server
//     already refuses a stale browser write over them (see SERVER_WINS).
//   • Chats — the BROWSER's copy wins if it has unsaved changes. Only the tab that
//     is generating writes a chat, and a stream in progress dirties its row on every
//     token; replacing it would erase a reply as it is written.
//
// "Unsaved" means the row differs by reference from what was last saved
// (the baseline), the same test the diff uses.

import type { Baseline, SyncedName } from "./stateDiff";

type Row = { id: string };
export type Collections = Partial<Record<SyncedName, Row[]>>;

export interface RemoteChanges {
  upserts:  Partial<Record<SyncedName, Array<{ seq: number; data: unknown }>>>;
  removals: Partial<Record<SyncedName, string[]>>;
}

export interface MergeResult {
  /** Only the collections that changed, ready to set on the store */
  next: Collections;
  /** Rows now holding the remote version (or gone): the caller re-baselines these */
  touched: Array<{ collection: SyncedName; id: string }>;
  /** Local unsaved edits that the server's version replaced, for the user to be told */
  discarded: Array<{ collection: SyncedName; id: string; what: "edit" | "delete" }>;
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

export function mergeRemote(local: Collections, baseline: Baseline, changes: RemoteChanges): MergeResult {
  const out: MergeResult = { next: {}, touched: [], discarded: [] };
  const names = new Set<SyncedName>([
    ...(Object.keys(changes.upserts) as SyncedName[]),
    ...(Object.keys(changes.removals) as SyncedName[]),
  ]);

  for (const name of names) {
    const clientWins = name === "chats";
    const rows = [...(local[name] ?? [])];
    const base = baseline[name] ?? new Map();
    let touchedAny = false;
    const dirty = (id: string, row: Row | undefined) => base.get(id) !== row;

    for (const id of changes.removals[name] ?? []) {
      const at = rows.findIndex((r) => r.id === id);
      if (at === -1) continue;
      if (dirty(id, rows[at])) {
        if (clientWins) continue;                               // the browser's pending chat write stands
        out.discarded.push({ collection: name, id, what: "edit" });
      }
      rows.splice(at, 1);
      out.touched.push({ collection: name, id });
      touchedAny = true;
    }

    for (const { data } of changes.upserts[name] ?? []) {
      if (!data || typeof data !== "object" || typeof (data as Row).id !== "string") continue;
      const remote = data as Row;
      const at = rows.findIndex((r) => r.id === remote.id);

      if (at === -1) {
        // Absent locally. If the baseline has it, the browser deleted it and has
        // not saved that yet: a pending local delete against a remote change.
        if (base.has(remote.id)) {
          if (clientWins) continue;
          out.discarded.push({ collection: name, id: remote.id, what: "delete" });
        }
        if (clientWins) rows.unshift(remote); else rows.push(remote);   // chats list newest-first
      } else {
        if (same(rows[at], remote)) continue;                   // our own write coming back, or no real change
        if (dirty(remote.id, rows[at])) {
          if (clientWins) continue;
          out.discarded.push({ collection: name, id: remote.id, what: "edit" });
        }
        rows[at] = remote;
      }
      out.touched.push({ collection: name, id: remote.id });
      touchedAny = true;
    }

    if (touchedAny) out.next[name] = rows;
  }
  return out;
}

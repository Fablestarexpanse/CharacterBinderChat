// ─── Entity duplicate detection ───────────────────────────────────────────────
// Surfacing entities that are probably the same thing under two ids, for the
// inspector's merge affordance. This is a READ-side heuristic: the write-side
// EntityResolver folds ids by display name before anything is stored.

import type { DbEntity } from "@/lib/db/models";

// ─── Duplicate detection ──────────────────────────────────────────────────────

/** Normalize a string to a bare stem for loose comparison */
function stem(s: string): string {
  return s.toLowerCase().replace(/[\s_\-\.]+/g, "");
}

/**
 * Return clusters of entity ids that are likely duplicates.
 *
 * Two entities are candidates when their stemmed names match, or their
 * stemmed ids do — case and separator variants of the same word, so
 * "Char-Ronan" clusters with "char_ronan". Substring pairs like "ronan" and
 * "ronan_voss" are NOT caught: stemming only strips separators, and those two
 * stem differently. Catching them is the write-side EntityResolver's job,
 * which folds by display name before anything is stored.
 *
 * Clusters of two or more are returned; a merge is always the user's call.
 */
export function findDuplicateClusters(entities: DbEntity[]): string[][] {
  // Key: stem(name) — primary signal
  const byName = new Map<string, string[]>();
  for (const e of entities) {
    const k = stem(e.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push(e.id);
  }

  // Also cluster by stem(id), which catches a renamed entity whose id still
  // matches. Both maps feed the same union-find below, so a pair related by
  // either signal ends up in one cluster.
  const byIdStem = new Map<string, string[]>();
  for (const e of entities) {
    const k = stem(e.id);
    if (!byIdStem.has(k)) byIdStem.set(k, []);
    byIdStem.get(k)!.push(e.id);
  }

  // Union-find: merge clusters that share at least one member
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const ids of byName.values()) {
    if (ids.length >= 2) for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  }
  for (const ids of byIdStem.values()) {
    if (ids.length >= 2) for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  }

  // Collect clusters
  const groups = new Map<string, string[]>();
  for (const e of entities) {
    const root = find(e.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(e.id);
  }

  return [...groups.values()].filter((g) => g.length >= 2);
}

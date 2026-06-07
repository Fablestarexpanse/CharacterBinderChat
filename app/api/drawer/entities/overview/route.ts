import { getStore } from "@/lib/db";
import type { DbEntity } from "@/lib/db/models";

export const dynamic = "force-dynamic";

// ─── Duplicate detection ──────────────────────────────────────────────────────

/** Normalize a string to a bare stem for loose comparison */
function stem(s: string): string {
  return s.toLowerCase().replace(/[\s_\-\.]+/g, "");
}

/**
 * Return clusters of entity IDs that are likely duplicates.
 * Two entities are considered candidates when:
 *   (a) their names are equal case-insensitively, OR
 *   (b) their normalized ID stems are equal (e.g. "ronan" ≈ "ronan_voss" if stemmed
 *       names match — the stem check catches ID variants of the same base word).
 * Clusters of size ≥ 2 are returned.
 */
function findDuplicateClusters(entities: DbEntity[]): string[][] {
  // Key: stem(name) — primary signal
  const byName = new Map<string, string[]>();
  for (const e of entities) {
    const k = stem(e.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push(e.id);
  }

  // Also cluster by stem(id) for IDs like "ronan" vs "ronan_voss"
  // Only merge into an existing name-cluster if the stems overlap
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

// ─── Route ────────────────────────────────────────────────────────────────────

// GET /api/drawer/entities/overview
export async function GET() {
  try {
    const store    = getStore();
    const entities = store.listEntities();

    // Fact count per entity (as subject) using live facts
    const enriched = entities.map((e) => ({
      id:          e.id,
      type:        e.type,
      name:        e.name,
      description: e.description,
      createdAt:   e.createdAt,
      factCount:   store.queryFacts(e.id).length,
    }));

    const possibleDuplicates = findDuplicateClusters(entities);

    return Response.json({ entities: enriched, possibleDuplicates });
  } catch (err) {
    console.error("[entities/overview]", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

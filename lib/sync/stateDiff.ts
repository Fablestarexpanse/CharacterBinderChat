// ─── State diff ───────────────────────────────────────────────────────────────
// What changed in the synced collections since the last successful save, so
// StateSync can send that instead of the whole app. Pure and client-safe.
//
// The store is immutable: an untouched row keeps its object identity, so
// "changed" is a reference comparison, not a deep one. A row that was rebuilt
// with equal content is re-sent, which is wasteful but never wrong.

export type SyncedName = "characters" | "chats" | "personas" | "lorebooks" | "scenarios" | "openers" | "presets";

export interface AppStatePatch {
  upserts: Partial<Record<SyncedName, Array<{ id: string }>>>;
  removals: Partial<Record<SyncedName, string[]>>;
  /** Full id order of a collection, sent only when the order or membership changed. */
  order: Partial<Record<SyncedName, string[]>>;
  defaultPresetId?: string | null;
  globalInstructions?: unknown;
}

/** id → row reference of what the server is known to hold. */
export type Baseline = Partial<Record<SyncedName, Map<string, { id: string }>>>;

export function snapshot(
  state: Partial<Record<SyncedName, Array<{ id: string }>>>,
  names: readonly SyncedName[],
): Baseline {
  return Object.fromEntries(
    names.map((n) => [n, new Map((state[n] ?? []).map((r) => [r.id, r]))]),
  );
}

export function diffState(
  baseline: Baseline,
  state: Partial<Record<SyncedName, Array<{ id: string }>>>,
  names: readonly SyncedName[],
): AppStatePatch | null {
  const patch: AppStatePatch = { upserts: {}, removals: {}, order: {} };
  let any = false;

  for (const name of names) {
    const before = baseline[name] ?? new Map();
    const rows = state[name] ?? [];
    const upserts = rows.filter((r) => before.get(r.id) !== r);
    const now = new Set(rows.map((r) => r.id));
    const removals = [...before.keys()].filter((id) => !now.has(id));
    const prevOrder = [...before.keys()];
    const orderChanged =
      removals.length > 0 ||
      rows.length !== prevOrder.length ||
      rows.some((r, i) => prevOrder[i] !== r.id);

    if (upserts.length) { patch.upserts[name] = upserts; any = true; }
    if (removals.length) { patch.removals[name] = removals; any = true; }
    if (orderChanged) { patch.order[name] = rows.map((r) => r.id); any = true; }
  }
  return any ? patch : null;
}

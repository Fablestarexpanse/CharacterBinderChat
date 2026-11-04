// ─── Sync engine ──────────────────────────────────────────────────────────────
// Makes SQLite the durable home of characters/chats/messages (they previously
// lived only in localStorage, where clearing site data destroyed everything).
//
// On mount:  GET /api/state — if the server has data it wins (hydrate the
//            store); if it's empty, push the local state up (first run /
//            migration from localStorage).
// After:     subscribe to the store and PATCH only the rows that changed since
//            the last successful save (see lib/sync/stateDiff.ts), debounced, so
//            the durable copy trails edits by at most a few seconds and a long
//            history is not re-uploaded on every streamed token. The first-run
//            seed is still a full PUT. localStorage persist stays on as a
//            same-browser cache.
//
// Server-authoritative: the server holds a revision that every write bumps. The tab
// polls /api/state/changes for what others (an agent, another device) wrote, and
// pulls BEFORE each save so it never builds on stale rows. Its saves carry the
// revision they are based on; if a shared row changed since, the server keeps its
// own copy and the tab takes it (see lib/sync/remote.ts for who wins what).
//
// A plain module, not part of a component: the loop must outlive React's
// development double-invoke of effects. That runs an effect's cleanup immediately
// after its first run, and a loop whose cleanup marks it "disposed" then never
// starts (no polling, no saving) — which is exactly what happened in development
// until the component was reduced to calling startSync() and stopping it only when
// it is really unmounted. See components/StateSync.tsx.

import { useFableStore } from "@/lib/store";
import type { PersistedAppState } from "@/lib/types";
import { diffState, snapshot, type Baseline, type SyncedName } from "@/lib/sync/stateDiff";
import { mergeRemote, type RemoteChanges } from "@/lib/sync/remote";
import { useUiStore } from "@/lib/store/ui";

const POLL_MS = 3000;      // how often an open, visible tab asks what changed elsewhere
const DEBOUNCE_MS = 800;   // trailing quiet-period before a save
const MAX_WAIT_MS = 5000;  // during constant streaming, save at least this often

/**
 * What this component syncs, in one place.
 *
 * The collections were written out four separate times — the save body, the
 * "does the server have anything" test, the hydrate call and the subscription
 * diff. A collection missing from any one of them breaks silently and
 * differently: never saved, treated as empty, dropped on load, or saved only
 * when something else changes. lib/db/appState.ts drives the server half off
 * its own table for the same reason.
 */
const SYNCED_COLLECTIONS = [
  "characters", "chats", "personas", "lorebooks", "scenarios", "presets",
] as const;

/** Singletons: not arrays, so they are counted and copied differently. */
const SYNCED_SINGLETONS = ["defaultPresetId", "globalInstructions"] as const;

/** Start syncing. Returns a function that stops it. Call once. */
export function startSync(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSaveAt = 0;
  let unsubscribe = () => {};
  // The subscription is created after an await, so an unmount can beat it —
  // the cleanup would then call the initial no-op and the real subscription
  // would live on, saving state for a component that is gone.
  let disposed = false;

  // What the server is known to hold. Only advanced after a save succeeds, so
  // a failed save is simply retried with the same (larger) diff next time.
  let baseline: Baseline = {};
  let sentSingletons: Record<string, unknown> = {};
  let saving = false;
  let dirtyWhileSaving = false;
  // The server revision this tab has fully taken in
  let baseRev = 0;
  // Which database this tab is talking to. A restore replaces it; revision
  // numbers mean nothing across databases, so a change of epoch means start over.
  let epoch: string | null = null;
  let pulling = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  const onVisible = () => { if (!document.hidden) void pull(); };

  const noteSaved = (state: ReturnType<typeof useFableStore.getState>) => {
    baseline = snapshot(state, SYNCED_COLLECTIONS);
    sentSingletons = Object.fromEntries(SYNCED_SINGLETONS.map((k) => [k, state[k]]));
  };

  const report = async (res: Response) => {
    const setSyncError = useFableStore.getState().setLastSyncError;
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      console.warn("[state-sync] save rejected:", data?.error ?? res.status);
      setSyncError(String(data?.error ?? `HTTP ${res.status}`));
      return false;
    }
    setSyncError(null);
    return true;
  };

  /** Full replace: first-run seeding only. */
  const saveFull = async () => {
    lastSaveAt = Date.now();
    const state = useFableStore.getState();
    const payload = Object.fromEntries([
      ...SYNCED_COLLECTIONS.map((key) => [key, state[key]]),
      ...SYNCED_SINGLETONS.map((key) => [key, state[key]]),
    ]);
    try {
      const res = await fetch("/api/state", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const body = await res.clone().json().catch(() => null) as { rev?: number } | null;
      if (await report(res)) {
        noteSaved(state);
        if (typeof body?.rev === "number") baseRev = body.rev;
      }
    } catch (e) {
      console.warn("[state-sync] save failed:", e);
      useFableStore.getState().setLastSyncError(e instanceof Error ? e.message : String(e));
    }
  };

  /**
   * Take in what other writers changed since `baseRev`. Called on a timer, when
   * the tab becomes visible, and before every save. Never throws: a failed poll
   * is just a poll that found nothing, and the next one tries again.
   */
  const pull = async () => {
    if (pulling) return;
    pulling = true;
    try {
      const res = await fetch(`/api/state/changes?since=${baseRev}`, { cache: "no-store" });
      if (!res.ok) return;
      const ch = await res.json() as RemoteChanges & {
        rev: number; epoch?: string; events: Array<{ id: number; source: string; summary: string; historyId: number | null }>;
      };
      if (ch.epoch) {
        if (epoch !== null && ch.epoch !== epoch) {
          // The database was replaced (a restore). Nothing this tab holds can be
          // reconciled with it, so load it fresh rather than guess.
          window.location.reload();
          return;
        }
        epoch ??= ch.epoch;
      }
      const noRows = !Object.keys(ch.upserts ?? {}).length && !Object.keys(ch.removals ?? {}).length;
      if (noRows && !(ch.events?.length)) { baseRev = Math.max(baseRev, ch.rev); return; }

      // Same trust as the initial load: ids are checked by the merge, and a chat
      // must carry its messages or the transcript view would throw on it.
      if (ch.upserts?.chats) {
        ch.upserts.chats = ch.upserts.chats.filter(
          (r) => Array.isArray((r.data as { messages?: unknown } | null)?.messages));
      }

      const store = useFableStore.getState();
      const local = Object.fromEntries(SYNCED_COLLECTIONS.map((k) => [k, store[k]]));
      const merged = mergeRemote(local, baseline, { upserts: ch.upserts ?? {}, removals: ch.removals ?? {} });

      if (Object.keys(merged.next).length > 0) {
        store.applyRemoteCollections(merged.next as Parameters<typeof store.applyRemoteCollections>[0]);
        // The tab now holds exactly the server's version of these rows, so they
        // are not "unsaved changes" — re-baseline them, or the next diff would
        // send them straight back.
        const after = useFableStore.getState();
        for (const t of merged.touched) {
          const row = (after[t.collection as SyncedName] as Array<{ id: string }>).find((r) => r.id === t.id);
          const m = (baseline[t.collection as SyncedName] ??= new Map());
          if (row) m.set(t.id, row); else m.delete(t.id);
        }
      }
      baseRev = Math.max(baseRev, ch.rev);

      const named = (collection: string, id: string) =>
        (local[collection as SyncedName] as Array<{ id: string; name?: string }> | undefined)?.find((r) => r.id === id)?.name ?? id;
      useUiStore.getState().pushRemoteNotices([
        // The user's own undo is not news to them
        ...(ch.events ?? []).filter((e) => e.source !== "user").map((e) => ({ text: e.summary, historyId: e.historyId, kind: "info" as const })),
        ...merged.discarded.map((d) => ({
          text: `“${named(d.collection, d.id)}” was ${d.what === "delete" ? "changed" : "changed elsewhere"} while you were ${d.what === "delete" ? "deleting it" : "editing it"} — the newer version was kept.`,
          historyId: null, kind: "lost" as const,
        })),
      ]);
    } catch (e) {
      console.warn("[state-sync] poll failed:", e instanceof Error ? e.message : e);
    } finally {
      pulling = false;
    }
  };

  // Deliberately not sendJson: a rejected save must not throw out of the
  // debounce timer, and the 409 wipe guard is a normal outcome here — it
  // is reported and the local state is kept, not treated as an error.
  const save = async () => {
    if (saving) { dirtyWhileSaving = true; return; }
    saving = true;
    lastSaveAt = Date.now();
    try {
      // Pull first: build the diff on what the server holds NOW, not on rows an
      // agent has since replaced. Rows this replaces drop out of the diff.
      await pull();
      const state = useFableStore.getState();
      const patch = diffState(baseline, state, SYNCED_COLLECTIONS);
      const singletons = Object.fromEntries(
        SYNCED_SINGLETONS.filter((k) => state[k] !== sentSingletons[k]).map((k) => [k, state[k]]));
      if (!patch && Object.keys(singletons).length === 0) return;

      const res = await fetch("/api/state", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ...(patch ?? { upserts: {}, removals: {}, order: {} }), ...singletons, baseRev }),
      });
      const body = await res.clone().json().catch(() => null) as
        { rev?: number; prevRev?: number; conflicts?: Array<{ collection: string; id: string; reason: string }> } | null;
      if (await report(res)) {
        noteSaved(state);
        const conflicts = body?.conflicts ?? [];
        // Only if nothing else wrote in between may the revision jump to ours;
        // otherwise the pull below must start from where this tab left off.
        const intervened = typeof body?.prevRev === "number" && body.prevRev !== baseRev;
        if (typeof body?.rev === "number" && !intervened && conflicts.length === 0) baseRev = body.rev;
        if (conflicts.length > 0) {
          // The server kept its own copy of these. Say so, then take it.
          useUiStore.getState().pushRemoteNotices(conflicts.map((c) => ({
            text: `Your change to “${(state[c.collection as SyncedName] as Array<{ id: string; name?: string }>).find((r) => r.id === c.id)?.name ?? c.id}” was not saved — it had been ${c.reason === "deleted" ? "deleted" : "changed"} elsewhere.`,
            historyId: null, kind: "lost" as const,
          })));
        }
        if (conflicts.length > 0 || intervened) await pull();
      }
    } catch (e) {
      console.warn("[state-sync] save failed:", e);
      useFableStore.getState().setLastSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      saving = false;
      if (dirtyWhileSaving) { dirtyWhileSaving = false; schedule(); }
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    const overdue = Date.now() - lastSaveAt > MAX_WAIT_MS;
    timer = setTimeout(save, overdue ? 0 : DEBOUNCE_MS);
  };

  (async () => {
    // Deliberately not getJson: this read distinguishes three outcomes —
    // data to hydrate, an empty server to seed, and a failure that must do
    // NEITHER — so it reads the status itself rather than collapsing the
    // last two into a thrown error.
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      // A failed read is not an empty database. Treating it as one would
      // hydrate nothing and then SAVE local state over the durable copy —
      // the one path in this file that can destroy data.
      if (!res.ok) {
        console.warn(`[state-sync] initial load failed: HTTP ${res.status} —`,
          (await res.text()).slice(0, 200));
        // A distinct message: nothing has failed to save yet, the saved copy
        // could not be read.
        useFableStore.getState().setLastSyncError(
          `could not load saved state (HTTP ${res.status})`);
        // Skip hydration AND the first-run save; later edits still sync, and
        // the route's own wipe guard covers a mass delete.
        throw new Error(`GET /api/state returned ${res.status}`);
      }
      const data = (await res.json()) as Partial<PersistedAppState>;
      // Every collection counts. Presets are often the first thing
      // configured, and a durable copy holding only presets — or only
      // lorebooks — would otherwise be treated as empty and overwritten by
      // local state.
      const serverHasData = SYNCED_COLLECTIONS.some((key) => (data[key]?.length ?? 0) > 0);

      if (serverHasData) {
        // Checked, not asserted: the durable copy is JSON on disk that a
        // crashed write or a hand-edit could leave malformed, and an entry
        // without an id fails the route's own validation on the way back
        // out — so the whole sync would start failing silently.
        const withIds = <T,>(rows: T[] | undefined): T[] =>
          (rows ?? []).filter((r): r is T => !!r && typeof (r as { id?: unknown }).id === "string");

        useFableStore.getState().hydrateFromServer({
          characters: withIds(data.characters),
          personas:   withIds(data.personas),
          lorebooks:  withIds(data.lorebooks),
          scenarios:  withIds(data.scenarios),
          presets:    withIds(data.presets),
          // Chats carry nested messages, so they get the extra check.
          chats:      withIds(data.chats).filter((c) => Array.isArray(c.messages)),
          defaultPresetId:    typeof data.defaultPresetId === "string" ? data.defaultPresetId : null,
          globalInstructions: data.globalInstructions ?? {},
        });
        // The server now holds exactly what was just hydrated
        noteSaved(useFableStore.getState());
        baseRev = typeof (data as { rev?: unknown }).rev === "number" ? (data as { rev: number }).rev : 0;
        epoch = typeof (data as { epoch?: unknown }).epoch === "string" ? (data as { epoch: string }).epoch : null;
      } else {
        // First run: seed the durable copy from local state
        await saveFull();
      }
    } catch (e) {
      // A thrown read (network down, bad JSON) lands here rather than at the
      // status check above, so it needs the same in-app surface.
      console.warn("[state-sync] initial load failed:", e);
      useFableStore.getState().setLastSyncError(
        `could not load saved state — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      // Either way the window is over: the app can render and accept edits.
      useFableStore.getState().setSyncReady(true);
    }

    if (disposed) return;

    // Subscribe only after hydration so the initial replace doesn't echo back
    unsubscribe = useFableStore.subscribe((state, prev) => {
      const changed =
        SYNCED_COLLECTIONS.some((key) => state[key] !== prev[key]) ||
        SYNCED_SINGLETONS.some((key) => state[key] !== prev[key]);
      if (changed) schedule();
    });

    // Pick up what other writers do, without waiting for this tab to save.
    // Skipped while hidden: a background tab has no one to tell.
    pollTimer = setInterval(() => { if (!document.hidden && !saving) void pull(); }, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
  })();

  return () => {
    disposed = true;
    unsubscribe();
    if (timer) clearTimeout(timer);
    if (pollTimer) clearInterval(pollTimer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
  };
}

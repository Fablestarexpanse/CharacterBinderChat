"use client";

// ─── State Sync ───────────────────────────────────────────────────────────────
// Makes SQLite the durable home of characters/chats/messages (they previously
// lived only in localStorage, where clearing site data destroyed everything).
//
// On mount:  GET /api/state — if the server has data it wins (hydrate the
//            store); if it's empty, push the local state up (first run /
//            migration from localStorage).
// After:     subscribe to the store and PUT the full state, debounced, so the
//            durable copy trails edits by at most a few seconds. localStorage
//            persist stays on as a same-browser cache.
//
// Known limitation: last-write-wins. Two browsers editing simultaneously will
// not merge — fine for a single-user local app.

import { useEffect, useRef } from "react";
import { useFableStore } from "@/lib/store";
import type { PersistedAppState } from "@/lib/types";

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

export function StateSync() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // guard against StrictMode double-invoke
    started.current = true;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastSaveAt = 0;
    let unsubscribe = () => {};
    // The subscription is created after an await, so an unmount can beat it —
    // the cleanup would then call the initial no-op and the real subscription
    // would live on, saving state for a component that is gone.
    let disposed = false;

    const save = async () => {
      lastSaveAt = Date.now();
      const state = useFableStore.getState();
      const payload = Object.fromEntries([
        ...SYNCED_COLLECTIONS.map((key) => [key, state[key]]),
        ...SYNCED_SINGLETONS.map((key) => [key, state[key]]),
      ]);
      // Deliberately not sendJson: a rejected save must not throw out of the
      // debounce timer, and the 409 wipe guard is a normal outcome here — it
      // is reported and the local state is kept, not treated as an error.
      try {
        const res = await fetch("/api/state", {
          method:  "PUT",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          console.warn("[state-sync] save rejected:", data?.error ?? res.status);
        }
      } catch (e) {
        console.warn("[state-sync] save failed:", e);
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
        } else {
          // First run: seed the durable copy from local state
          await save();
        }
      } catch (e) {
        console.warn("[state-sync] initial load failed:", e);
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
    })();

    return () => {
      disposed = true;
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return null;
}
